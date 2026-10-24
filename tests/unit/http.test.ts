import { describe, expect, it } from "vitest";
import { requestJson } from "@/lib/providers/http";
import { AdapterError } from "@/lib/providers/types";

const noSleep = async () => {};

describe("provider HTTP client", () => {
  it("retries a 500 once and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await requestJson("https://example.test/usage", {
      fetchImpl,
      retries: 1,
      sleepImpl: noSleep,
    });

    expect(calls).toBe(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("does not retry authentication failures", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 403 });
    }) as unknown as typeof fetch;

    await expect(
      requestJson("https://example.test/usage", {
        fetchImpl,
        retries: 2,
        sleepImpl: noSleep,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toBe(1);
  });

  it("rejects oversized responses", async () => {
    const fetchImpl = (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(3 * 1024 * 1024) },
      })) as unknown as typeof fetch;

    await expect(
      requestJson("https://example.test/usage", { fetchImpl, retries: 0 }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("returns a typed timeout error", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    const promise = requestJson("https://example.test/usage", {
      fetchImpl,
      retries: 0,
      timeoutMs: 20,
      sleepImpl: noSleep,
    });

    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("redacts nothing into messages and reports malformed JSON", async () => {
    const fetchImpl = (async () => new Response("<html>nope</html>", { status: 200 })) as unknown as typeof fetch;

    await expect(
      requestJson("https://example.test/usage", { fetchImpl, retries: 0 }),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});
