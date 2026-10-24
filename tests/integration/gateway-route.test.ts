import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createAccount } from "@/lib/accounts";
import { createGatewayToken } from "@/lib/gateway/tokens";
import { invalidatePricingCacheForTests } from "@/lib/gateway/pricing";
import { flushGatewayUsage } from "@/lib/gateway/record";
import { POST } from "@/app/api/gateway/[accountId]/[...path]/route";
import { createTestUser, resetDatabase } from "./helpers";

const PRICING = {
  inference: [{ model: "test-model", input: 1, cached_input: 0.1, output: 2 }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chatResponse(usage = true): Response {
  return jsonResponse({
    id: "chatcmpl_1",
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    ...(usage
      ? { usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 } }
      : {}),
  });
}

function request(
  accountId: string,
  token: string | null,
  path = ["v1", "chat", "completions"],
): NextRequest {
  return new NextRequest(`http://localhost/api/gateway/${accountId}/${path.join("/")}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hi" }] }),
  });
}

async function call(accountId: string, token: string | null): Promise<Response> {
  return POST(request(accountId, token), {
    params: Promise.resolve({ accountId, path: ["v1", "chat", "completions"] }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDatabase();
  invalidatePricingCacheForTests();
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://console.river.ai/api/public/pricing")) {
      return jsonResponse(PRICING);
    }
    if (url.startsWith("https://tokenharbor.ai/models")) {
      return new Response("<html><script>self.__next_f.push([1,\"{\\\"rows\\\":[]}\"])</script></html>", {
        headers: { "content-type": "text/html" },
      });
    }
    return chatResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await flushGatewayUsage();
  vi.unstubAllGlobals();
});

describe("gateway route", () => {
  it("authenticates the gateway token, injects the provider key, and records usage", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "RIVER_AI",
      displayName: "River",
      authMode: "LIVE",
      credential: "rv_provider_secret",
    });
    const issued = createGatewayToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { gatewayTokenHash: issued.tokenHash, gatewayTokenHint: issued.hint },
    });

    const response = await call(account.id, issued.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "test-model" });

    const upstreamCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith("https://api.river.ai/v1/chat/completions"),
    );
    expect(upstreamCall).toBeTruthy();
    const headers = new Headers(upstreamCall?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer rv_provider_secret");
    expect(headers.get("x-api-key")).toBe("rv_provider_secret");
    expect(headers.get("authorization")).not.toContain(issued.token);
    expect(headers.get("cookie")).toBeNull();

    await flushGatewayUsage();
    const usage = await prisma.usageRecord.findFirst({
      where: { providerAccountId: account.id },
    });
    expect(usage).toMatchObject({
      modelId: "test-model",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      source: "ESTIMATED",
      currency: "USD",
    });
    // $1.00 input + $1.00 output at the mocked list price.
    expect(Number(usage?.cost)).toBeCloseTo(2, 8);
  });

  it("rejects a missing or invalid token before contacting the provider", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "RIVER_AI",
      displayName: "River",
      authMode: "LIVE",
      credential: "rv_provider_secret",
    });

    const response = await call(account.id, null);
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const wrong = await call(account.id, "ttg_not_a_real_token_value_000000000000");
    expect(wrong.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses providers without a compatible upstream", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "COMMANDCODE",
      displayName: "Command",
      authMode: "LIVE",
      credential: "cc_provider_secret",
    });
    const issued = createGatewayToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { gatewayTokenHash: issued.tokenHash, gatewayTokenHint: issued.hint },
    });

    const response = await call(account.id, issued.token);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures usage from a streamed OpenAI response", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "RIVER_AI",
      displayName: "River",
      authMode: "LIVE",
      credential: "rv_provider_secret",
    });
    const issued = createGatewayToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { gatewayTokenHash: issued.tokenHash, gatewayTokenHint: issued.hint },
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ model: "test-model", choices: [{ delta: { content: "hi" } }] })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              model: "test-model",
              choices: [],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://console.river.ai/api/public/pricing")) {
        return jsonResponse(PRICING);
      }
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await call(account.id, issued.token);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("data: [DONE]");

    await flushGatewayUsage();
    const usage = await prisma.usageRecord.findFirst({
      where: { providerAccountId: account.id },
    });
    expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
  });
});
