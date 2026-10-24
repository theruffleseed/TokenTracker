import { describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/commandcode-billing.json";
import {
  CommandCodeAdapter,
  parseCommandCodeBilling,
} from "@/lib/providers/commandcode";
import { deriveQuota } from "@/lib/providers/parsing";

const NOW = new Date("2026-10-24T12:00:00.000Z");

describe("Command Code adapter", () => {
  it("normalizes monthly allowance, rolling windows, and extra credits", () => {
    const parsed = parseCommandCodeBilling({
      credits: fixture.credits,
      subscription: fixture.subscriptions,
      whoami: fixture.whoami,
      now: NOW,
    });

    const monthly = parsed.quota.find((row) => row.window === "monthly");
    expect(monthly).toMatchObject({
      unit: "usd",
      limit: 80,
      remaining: 62.5,
      used: 17.5,
      remainingPercent: 78.125,
      resetsAt: "2026-11-24T00:00:00.000Z",
    });

    const fiveHour = parsed.quota.find((row) => row.window === "rolling_5h");
    expect(fiveHour).toMatchObject({ limit: 16, used: 4.25, remaining: 11.75 });
    expect(fiveHour?.remainingPercent).toBeCloseTo(73.4375, 3);

    const weekly = parsed.quota.find((row) => row.window === "weekly");
    expect(weekly?.remainingPercent).toBe(55);

    expect(parsed.credits).toEqual([
      expect.objectContaining({ amount: 12.5, creditType: "WALLET", currency: "USD" }),
      expect.objectContaining({ amount: 0, creditType: "REWARD", currency: "USD" }),
    ]);
    expect(parsed.planName).toBe("Pro V2");
    expect(parsed.accountLabel).toBe("dev@example.com");
  });

  it("leaves missing values null rather than zero", () => {
    const parsed = parseCommandCodeBilling({
      credits: { windowLimits: { fiveHour: { cap: 16 } } },
      now: NOW,
    });

    const fiveHour = parsed.quota.find((row) => row.window === "rolling_5h");
    expect(fiveHour?.used).toBeNull();
    expect(fiveHour?.remaining).toBeNull();
    expect(fiveHour?.remainingPercent).toBeNull();
    expect(parsed.credits).toEqual([]);
  });

  it("handles an unwrapped credits payload", () => {
    const parsed = parseCommandCodeBilling({
      credits: {
        monthlyCreditsGranted: 10,
        monthlyCredits: 4,
        windowLimits: {},
      },
      now: NOW,
    });
    expect(parsed.quota.find((row) => row.window === "monthly")?.remainingPercent).toBe(40);
  });

  it("reads rolling windows from the live envelope beside the credits object", () => {
    const parsed = parseCommandCodeBilling({
      credits: {
        credits: { monthlyCredits: 50, purchasedCredits: 5 },
        windowLimits: {
          fiveHour: { used: 4, cap: 16, resetAt: 1792870800000 },
          weekly: { used: 10, cap: 40, resetAt: 1793302800000 },
        },
      },
      now: NOW,
    });

    expect(parsed.quota.find((row) => row.window === "rolling_5h")).toMatchObject({
      limit: 16,
      used: 4,
      remaining: 12,
      remainingPercent: 75,
      resetsAt: "2026-10-24T19:40:00.000Z",
    });
    expect(parsed.quota.find((row) => row.window === "weekly")).toMatchObject({
      limit: 40,
      used: 10,
      remaining: 30,
      remainingPercent: 75,
    });
    expect(parsed.quota.find((row) => row.window === "monthly")?.remaining).toBe(50);
  });

  it("derives the monthly grant from the recognized plan when omitted", () => {
    const parsed = parseCommandCodeBilling({
      credits: {
        credits: { monthlyCredits: 60.6443625957 },
      },
      subscription: {
        planId: "individual-goat",
        currentPeriodEnd: "2026-11-24T00:00:00.000Z",
      },
      now: NOW,
    });

    const monthly = parsed.quota.find((row) => row.window === "monthly");
    expect(monthly).toMatchObject({
      limit: 70,
      remaining: 60.6443625957,
      resetsAt: "2026-11-24T00:00:00.000Z",
    });
    expect(monthly?.used).toBeCloseTo(9.355637, 5);
    expect(monthly?.remainingPercent).toBeCloseTo(86.6348, 3);
    expect(parsed.planName).toBe("Goat");
  });

  it("leaves an unrecognized plan's monthly percentage unset", () => {
    const parsed = parseCommandCodeBilling({
      credits: { credits: { monthlyCredits: 50 } },
      subscription: { planId: "individual-mystery" },
      now: NOW,
    });

    const monthly = parsed.quota.find((row) => row.window === "monthly");
    expect(monthly).toMatchObject({ limit: null, remaining: 50, remainingPercent: null });
  });

  it("does not invent a monthly window from a plan id alone", () => {
    const parsed = parseCommandCodeBilling({
      credits: { purchasedCredits: 5 },
      subscription: { planId: "individual-go-v1" },
      now: NOW,
    });
    expect(parsed.quota.find((row) => row.window === "monthly")).toBeUndefined();
    expect(parsed.credits[0]?.amount).toBe(5);
  });

  it("fetches billing, subscription, and identity with one shared key", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/alpha/billing/credits")) {
        return new Response(JSON.stringify(fixture.credits), { status: 200 });
      }
      if (url.includes("/alpha/billing/subscriptions")) {
        return new Response(JSON.stringify(fixture.subscriptions), { status: 200 });
      }
      return new Response(JSON.stringify(fixture.whoami), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new CommandCodeAdapter({
      credential: "cmd_test",
      accountLabel: null,
      planName: null,
      fetchImpl,
      now: () => NOW,
    });

    const result = await adapter.getQuotaSnapshots();
    expect(result.ok).toBe(true);
    const credits = await adapter.getCreditSnapshots!();
    expect(credits.ok).toBe(true);
    expect(urls).toHaveLength(3);
    expect(urls.every((url) => url.startsWith("https://api.commandcode.ai"))).toBe(true);
  });

  it("keeps optional lookup failures isolated", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/alpha/billing/credits")) {
        return new Response(JSON.stringify(fixture.credits), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
    }) as unknown as typeof fetch;

    const adapter = new CommandCodeAdapter({
      credential: "cmd_test",
      accountLabel: null,
      planName: null,
      fetchImpl,
      now: () => NOW,
    });

    const result = await adapter.getAccountSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.accountLabel).toBeNull();
      expect(result.diagnostics?.some((line) => line.includes("Optional lookup failed"))).toBe(true);
    }
  });
});

describe("quota derivation", () => {
  it("computes remaining from limit and used", () => {
    expect(
      deriveQuota({ limit: 10, used: 4, remaining: null, remainingPercent: null }),
    ).toEqual({ limit: 10, used: 4, remaining: 6, remainingPercent: 60 });
  });

  it("computes used from limit and remaining", () => {
    expect(
      deriveQuota({ limit: 100, used: null, remaining: 25, remainingPercent: null }),
    ).toEqual({ limit: 100, used: 75, remaining: 25, remainingPercent: 25 });
  });

  it("keeps unknown values null", () => {
    expect(deriveQuota({ limit: null, used: null, remaining: null, remainingPercent: null })).toEqual({
      limit: null,
      used: null,
      remaining: null,
      remainingPercent: null,
    });
  });
});
