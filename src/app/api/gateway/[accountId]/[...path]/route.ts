import type { NextRequest } from "next/server";
import type { ProviderAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readAccountCredential } from "@/lib/credentials";
import {
  gatewayEndpointFor,
  gatewayUpstreamFor,
  isMeteredEndpoint,
} from "@/lib/gateway/config";
import { enqueueGatewayUsage } from "@/lib/gateway/record";
import {
  gatewayTokenFromHeaders,
  hashGatewayToken,
  looksLikeGatewayToken,
} from "@/lib/gateway/tokens";
import { SseUsageCollector, usageFromJson } from "@/lib/gateway/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

const FORWARDED_HEADERS = [
  "accept",
  "anthropic-version",
  "anthropic-beta",
  "openai-beta",
  "openai-organization",
  "openai-project",
];

const RESPONSE_HEADERS = [
  "content-type",
  "request-id",
  "x-request-id",
  "openai-processing-ms",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-tokens-remaining",
  "retry-after",
];

function errorResponse(
  status: number,
  message: string,
  type: string,
  code?: string,
): Response {
  return Response.json(
    { error: { message, type, ...(code ? { code } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "no-store");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveAccount(
  request: NextRequest,
  accountId: string,
): Promise<
  | { ok: true; account: ProviderAccount; credential: string; baseUrl: string }
  | { ok: false; response: Response }
> {
  const token = gatewayTokenFromHeaders(request.headers);
  if (!token || !looksLikeGatewayToken(token)) {
    return {
      ok: false,
      response: errorResponse(
        401,
        "Missing gateway token. Send it as Authorization: Bearer ttg_… or x-api-key.",
        "authentication_error",
        "invalid_api_key",
      ),
    };
  }

  const user = await prisma.user.findUnique({
    where: { gatewayTokenHash: hashGatewayToken(token) },
    select: { id: true },
  });
  if (!user) {
    return {
      ok: false,
      response: errorResponse(401, "Invalid gateway token.", "authentication_error", "invalid_api_key"),
    };
  }

  const account = await prisma.providerAccount.findFirst({
    where: { id: accountId, userId: user.id },
  });
  if (!account) {
    return {
      ok: false,
      response: errorResponse(404, "Provider connection not found.", "invalid_request_error"),
    };
  }
  if (!account.isActive) {
    return {
      ok: false,
      response: errorResponse(403, "This provider connection is paused.", "permission_error"),
    };
  }

  const upstream = gatewayUpstreamFor(account.provider);
  if (!upstream) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "This provider does not expose a compatible inference API. Only TokenHarbor and River connections can use the gateway.",
        "invalid_request_error",
      ),
    };
  }
  if (account.authMode !== "LIVE") {
    return {
      ok: false,
      response: errorResponse(
        400,
        "The gateway requires a live connection with a stored provider key.",
        "invalid_request_error",
      ),
    };
  }

  const credential = await readAccountCredential(account);
  if (!credential) {
    return {
      ok: false,
      response: errorResponse(
        409,
        "No provider key is stored for this connection. Replace the key first.",
        "invalid_request_error",
      ),
    };
  }

  return { ok: true, account, credential, baseUrl: upstream.baseUrl };
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ accountId: string; path: string[] }> },
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") {
    return errorResponse(405, "Only GET and POST are supported.", "invalid_request_error");
  }

  const { accountId, path: segments } = await context.params;
  const path = segments;
  const method = request.method === "GET" ? "GET" : "POST";
  const endpoint = gatewayEndpointFor(path, method);
  if (!endpoint) {
    return errorResponse(
      404,
      "Unsupported gateway path. Use /v1/chat/completions, /v1/messages, /v1/responses, or /v1/models.",
      "invalid_request_error",
    );
  }

  const resolved = await resolveAccount(request, accountId);
  if (!resolved.ok) return resolved.response;
  const { account, credential, baseUrl } = resolved;

  let payload: Record<string, unknown> | null = null;
  if (method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return errorResponse(415, "Expected an application/json body.", "invalid_request_error");
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      return errorResponse(413, "Request body is too large.", "invalid_request_error");
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
      payload = parsed;
    } catch {
      return errorResponse(400, "Request body is not valid JSON.", "invalid_request_error");
    }

    if (typeof payload.model !== "string" || !payload.model.trim()) {
      return errorResponse(400, "A model ID is required.", "invalid_request_error");
    }

    // OpenAI only returns token usage for streamed chat responses when asked.
    if (endpoint === "openai_chat" && payload.stream === true) {
      const current = isRecord(payload.stream_options) ? payload.stream_options : {};
      payload.stream_options = { ...current, include_usage: true };
    }
  }

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("content-type", "application/json");
  if (!headers.has("accept")) {
    headers.set("accept", payload?.stream === true ? "text/event-stream" : "application/json");
  }
  headers.set("authorization", `Bearer ${credential}`);
  headers.set("x-api-key", credential);
  headers.set("user-agent", "TokenTracker-Gateway/0.1");

  const upstreamUrl = `${baseUrl}/${path.join("/")}${request.nextUrl.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(payload) : undefined,
      signal: request.signal,
      cache: "no-store",
      redirect: "follow",
    });
  } catch (error) {
    console.warn(
      `[gateway] upstream request failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return errorResponse(502, "Could not reach the provider.", "api_error");
  }

  const model = payload && typeof payload.model === "string" ? payload.model : null;
  const contentType = upstream.headers.get("content-type") ?? "application/json";

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  }

  if (contentType.includes("text/event-stream") && upstream.body) {
    if (!isMeteredEndpoint(endpoint)) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders(upstream),
      });
    }

    const collector = new SseUsageCollector(endpoint, model);
    const decoder = new TextDecoder();
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        try {
          collector.push(decoder.decode(chunk, { stream: true }));
        } catch {
          // Capped parsing must never interrupt the provider stream.
        }
      },
      flush() {
        try {
          collector.push(decoder.decode());
          const usage = collector.finish();
          if (usage) enqueueGatewayUsage(account, usage, { pricingKey: credential });
        } catch {
          // Usage capture is best-effort.
        }
      },
    });

    return new Response(upstream.body.pipeThrough(transform), {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  }

  const text = await upstream.text();
  if (isMeteredEndpoint(endpoint)) {
    try {
      const usage = usageFromJson(JSON.parse(text), endpoint, model);
      if (usage) enqueueGatewayUsage(account, usage, { pricingKey: credential });
    } catch {
      // Non-JSON success bodies (for example proxied files) are left untouched.
    }
  }

  return new Response(text, {
    status: upstream.status,
    headers: responseHeaders(upstream),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ accountId: string; path: string[] }> },
): Promise<Response> {
  return handle(request, context);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ accountId: string; path: string[] }> },
): Promise<Response> {
  return handle(request, context);
}
