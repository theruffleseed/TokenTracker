import { describe, expect, it } from "vitest";
import { primaryCredit, summaryWindows } from "@/lib/dashboard-summary";
import type { CreditView, QuotaView } from "@/lib/dashboard";

function quota(overrides: Partial<QuotaView> = {}): QuotaView {
  return {
    id: `quota-${overrides.window ?? "monthly"}`,
    window: "monthly",
    unit: "percent",
    limit: 100,
    used: 10,
    remaining: 90,
    remainingPercent: 90,
    resetsAt: null,
    modelScope: null,
    source: "live",
    observedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

function credit(overrides: Partial<CreditView> = {}): CreditView {
  return {
    id: `credit-${overrides.creditType ?? "WALLET"}`,
    amount: 10,
    currency: "USD",
    creditType: "WALLET",
    source: "manual",
    observedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("summaryWindows", () => {
  it("orders the three headline windows as 5-hour, weekly, monthly", () => {
    const result = summaryWindows([
      quota({ window: "monthly" }),
      quota({ window: "rolling_5h" }),
      quota({ window: "weekly" }),
    ]);

    expect(result.map((entry) => entry.label)).toEqual(["5-hour", "Weekly", "Monthly"]);
  });

  it("ignores non-headline windows when a headline window exists", () => {
    const result = summaryWindows([
      quota({ window: "weekly" }),
      quota({ window: "daily" }),
    ]);

    expect(result.map((entry) => entry.key)).toEqual(["weekly"]);
  });

  it("falls back to recorded windows when no headline window exists", () => {
    const result = summaryWindows([
      quota({ window: "daily" }),
      quota({ window: "other" }),
    ]);

    expect(result.map((entry) => entry.key)).toEqual(["daily", "other"]);
  });

  it("returns nothing when no quota exists", () => {
    expect(summaryWindows([])).toEqual([]);
  });

  it("shows both weekly scopes, paid before free", () => {
    const result = summaryWindows([
      quota({ id: "free", window: "weekly", modelScope: "Free models" }),
      quota({ id: "paid", window: "weekly", modelScope: "Paid models" }),
    ]);

    expect(result.map((entry) => entry.label)).toEqual(["Paid models", "Free models"]);
    expect(result.map((entry) => entry.quota.id)).toEqual(["paid", "free"]);
  });

  it("keeps one row per headline window before adding extra scopes", () => {
    const result = summaryWindows([
      quota({ id: "five", window: "rolling_5h" }),
      quota({ id: "paid", window: "weekly", modelScope: "Paid models" }),
      quota({ id: "free", window: "weekly", modelScope: "Free models" }),
      quota({ id: "monthly", window: "monthly" }),
    ]);

    expect(result.map((entry) => entry.quota.id)).toEqual(["five", "paid", "monthly"]);
  });

  it("groups scoped fallback windows without dropping the second scope", () => {
    const result = summaryWindows([
      quota({ id: "daily-paid", window: "daily", modelScope: "Paid models" }),
      quota({ id: "daily-free", window: "daily", modelScope: "Free models" }),
    ]);

    expect(result.map((entry) => entry.label)).toEqual(["Paid models", "Free models"]);
  });
});

describe("primaryCredit", () => {
  it("prefers a wallet balance over other credit types", () => {
    const result = primaryCredit([
      credit({ id: "reward", creditType: "REWARD", amount: 2 }),
      credit({ id: "wallet", creditType: "WALLET", amount: 25 }),
    ]);

    expect(result?.id).toBe("wallet");
  });

  it("prefers a USD balance over another currency", () => {
    const result = primaryCredit([
      credit({ id: "eur", currency: "EUR", amount: 99 }),
      credit({ id: "usd", creditType: "PROMOTIONAL", amount: 5 }),
    ]);

    expect(result?.id).toBe("usd");
  });

  it("falls back to the first balance when no USD balance exists", () => {
    const result = primaryCredit([credit({ id: "eur", currency: "EUR", creditType: "REWARD" })]);

    expect(result?.id).toBe("eur");
  });

  it("returns null when there are no balances", () => {
    expect(primaryCredit([])).toBeNull();
  });
});
