import { describe, expect, it } from "vitest";
import opencodeFixture from "../fixtures/opencode-usage.json";
import { OpenCodeGoAdapter, parseOpenCodeUsage } from "@/lib/providers/opencode-go";
import { AdapterError } from "@/lib/providers/types";

const NOW = new Date("2026-10-24T12:00:00.000Z");

describe("OpenCode Go adapter", () => {
  it("parses rolling, weekly, and monthly meters as used percentages", () => {
    const parsed = parseOpenCodeUsage(opencodeFixture, NOW);

    expect(parsed.quota).toHaveLength(3);
    expect(parsed.planName).toBe("Go Plus");
    expect(parsed.accountLabel).toBe("dev@example.com");

    const rolling = parsed.quota.find((row) => row.window === "rolling_5h");
    expect(rolling).toMatchObject({
      unit: "percent",
      limit: 100,
      used: 17,
      remaining: 83,
      remainingPercent: 83,
      resetsAt: "2026-10-24T15:30:00.000Z",
      source: "live",
    });

    const monthly = parsed.quota.find((row) => row.window === "monthly");
    expect(monthly?.remainingPercent).toBe(6);
  });

  it("never invents a window that is absent", () => {
    const parsed = parseOpenCodeUsage(
      { usage: { rolling: { percent: 50, resetsAt: "2026-10-24T13:00:00Z" } } },
      NOW,
    );
    expect(parsed.quota.map((row) => row.window)).toEqual(["rolling_5h"]);
  });

  it("supports relative reset seconds", () => {
    const parsed = parseOpenCodeUsage(
      { usage: { weekly: { percent: 10, resetsInSeconds: 3600 } } },
      NOW,
    );
    expect(parsed.quota[0]?.resetsAt).toBe("2026-10-24T13:00:00.000Z");
  });

  it("throws a malformed-response error instead of guessing", () => {
    expect(() => parseOpenCodeUsage({ usage: {} }, NOW)).toThrow(AdapterError);
    expect(() => parseOpenCodeUsage({ unexpected: true }, NOW)).toThrow(/no recognizable/i);
  });

  it("maps 401 responses to invalid credentials and does not retry", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }) as unknown as typeof fetch;

    const adapter = new OpenCodeGoAdapter({
      credential: "oc_sk_bad",
      accountLabel: null,
      planName: null,
      fetchImpl,
      now: () => NOW,
    });

    const result = await adapter.getQuotaSnapshots();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CREDENTIALS");
    expect(calls).toBe(1);
  });

  it("returns typed rate-limit errors with retry metadata", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "retry-after": "30" },
      });
    }) as unknown as typeof fetch;

    const adapter = new OpenCodeGoAdapter({
      credential: "oc_sk_test",
      accountLabel: null,
      planName: null,
      fetchImpl,
      now: () => NOW,
      sleepImpl: async () => {},
    });

    const result = await adapter.getQuotaSnapshots();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMITED");
      expect(result.error.retryAfterSeconds).toBe(30);
    }
    expect(calls).toBe(2);
  });
});
