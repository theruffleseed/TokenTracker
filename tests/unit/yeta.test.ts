import { describe, expect, it } from "vitest";
import { YetaAdapter, parseYetaBalance } from "@/lib/providers/yeta";
import { AdapterError } from "@/lib/providers/types";

const NOW = new Date("2026-10-25T10:00:00.000Z");

const SUBSCRIPTION = {
  object: "billing_subscription",
  hard_limit_usd: 120,
  soft_limit_usd: 120,
  system_hard_limit_usd: 120,
  access_until: 0,
};

const USAGE = { object: "list", total_usage: 2575 };

function adapter(fetchImpl: typeof fetch) {
  return new YetaAdapter({
    credential: "sk-test",
    accountLabel: "Yeta",
    planName: null,
    fetchImpl,
    now: () => NOW,
  });
}

describe("Yeta adapter", () => {
  it("derives the remaining USD balance from limit minus usage", () => {
    const parsed = parseYetaBalance(SUBSCRIPTION, USAGE);
    expect(parsed).toEqual({
      limit: 120,
      used: 25.75,
      remaining: 94.25,
      currency: "USD",
      unlimited: false,
    });
  });

  it("reports the balance as a wallet credit snapshot", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/subscription")) {
        return new Response(JSON.stringify(SUBSCRIPTION), { status: 200 });
      }
      return new Response(JSON.stringify(USAGE), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await adapter(fetchImpl).getCreditSnapshots();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          amount: 94.25,
          currency: "USD",
          creditType: "WALLET",
          observedAt: NOW.toISOString(),
          source: "live",
        },
      ]);
    }
    expect(calls).toEqual([
      "https://platform.yeta.ai/v1/dashboard/billing/subscription",
      "https://platform.yeta.ai/v1/dashboard/billing/usage",
    ]);
  });

  it("reports plan details and no quota windows", async () => {
    const fetchImpl = (async (url: string) =>
      new Response(
        JSON.stringify(url.endsWith("/subscription") ? SUBSCRIPTION : USAGE),
        { status: 200 },
      )) as unknown as typeof fetch;

    const account = await adapter(fetchImpl).validateConnection();
    expect(account.ok).toBe(true);
    if (account.ok) {
      expect(account.data.planName).toBe("Yeta");
      expect(account.data.planDetails).toBe("$94.25 remaining · $25.75 used");
    }

    const quota = await adapter(fetchImpl).getQuotaSnapshots();
    expect(quota.ok).toBe(true);
    if (quota.ok) expect(quota.data).toEqual([]);
  });

  it("clamps an over-spent balance to zero", () => {
    const parsed = parseYetaBalance(
      { hard_limit_usd: 10 },
      { total_usage: 2000 },
    );
    expect(parsed.remaining).toBe(0);
  });

  it("does not invent a balance for unlimited tokens", async () => {
    const fetchImpl = (async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/subscription")
            ? { hard_limit_usd: 100000000 }
            : { total_usage: 0 },
        ),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await adapter(fetchImpl).getCreditSnapshots();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it("maps 401 to invalid credentials without retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { message: "Invalid token", type: "new_api_error" } }),
        { status: 401 },
      );
    }) as unknown as typeof fetch;

    const result = await adapter(fetchImpl).getCreditSnapshots();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CREDENTIALS");
    expect(calls).toBe(1);
  });

  it("rejects a billing payload without a limit", () => {
    expect(() => parseYetaBalance({}, USAGE)).toThrow(AdapterError);
    expect(() => parseYetaBalance({}, USAGE)).toThrow(/billing limit/i);
  });

  it("surfaces a 200-level API error", () => {
    expect(() =>
      parseYetaBalance({ error: { message: "Invalid token" } }, USAGE),
    ).toThrow(/Invalid token/);
  });
});
