import { describe, expect, it } from "vitest";
import {
  manualQuotaSchema,
  manualCreditSchema,
  providerCreateSchema,
  settingsSchema,
} from "@/lib/schemas";
import {
  creditSnapshotInputSchema,
  quotaSnapshotInputSchema,
} from "@/lib/providers/output";
import { redactMetadata } from "@/lib/audit";

describe("runtime validation", () => {
  it("requires credentials for live provider connections", () => {
    const result = providerCreateSchema.safeParse({
      provider: "OPENCODE_GO",
      displayName: "Work",
      authMode: "LIVE",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a manual connection without a credential", () => {
    const result = providerCreateSchema.safeParse({
      provider: "TOKENHARBOR",
      displayName: "Harbor",
      authMode: "MANUAL",
    });
    expect(result.success).toBe(true);
  });

  it("rejects quota snapshots without enough data", () => {
    const result = manualQuotaSchema.safeParse({
      windowType: "monthly",
      unit: "usd",
    });
    expect(result.success).toBe(false);
  });

  it("rejects used greater than limit", () => {
    const result = manualQuotaSchema.safeParse({
      windowType: "monthly",
      unit: "usd",
      limitValue: 10,
      usedValue: 12,
    });
    expect(result.success).toBe(false);
  });

  it("rejects internally inconsistent limit/used/remaining triples", () => {
    const result = manualQuotaSchema.safeParse({
      windowType: "monthly",
      unit: "usd",
      limitValue: 100,
      usedValue: 10,
      remainingValue: 95,
    });
    expect(result.success).toBe(false);
  });

  it("requires a percent for percent quotas", () => {
    const result = manualQuotaSchema.safeParse({
      windowType: "weekly",
      unit: "percent",
      limitValue: 100,
      usedValue: 10,
    });
    expect(result.success).toBe(false);
  });

  it("requires ISO reset timestamps", () => {
    const result = manualQuotaSchema.safeParse({
      windowType: "weekly",
      unit: "percent",
      remainingPercent: 80,
      resetsAt: "next tuesday",
    });
    expect(result.success).toBe(false);
  });

  it("validates credit currency and amount", () => {
    expect(
      manualCreditSchema.safeParse({ amount: 5, currency: "usd", creditType: "WALLET" }).success,
    ).toBe(true);
    expect(
      manualCreditSchema.safeParse({ amount: -1, currency: "USD", creditType: "WALLET" }).success,
    ).toBe(false);
    expect(
      manualCreditSchema.safeParse({ amount: 1, currency: "US", creditType: "WALLET" }).success,
    ).toBe(false);
  });

  it("rejects unknown timezones", () => {
    expect(settingsSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsSchema.safeParse({ timezone: "UTC" }).success).toBe(true);
  });

  it("enforces the adapter output contract", () => {
    const base = {
      window: "monthly",
      unit: "usd",
      limit: 10,
      used: 2,
      remaining: 8,
      remainingPercent: 80,
      resetsAt: null,
      observedAt: new Date().toISOString(),
      modelScope: null,
      source: "live",
    };

    expect(quotaSnapshotInputSchema.safeParse(base).success).toBe(true);
    expect(quotaSnapshotInputSchema.safeParse({ ...base, remainingPercent: 120 }).success).toBe(false);
    expect(quotaSnapshotInputSchema.safeParse({ ...base, extra: true }).success).toBe(false);
    expect(
      creditSnapshotInputSchema.safeParse({
        amount: 1,
        currency: "USD",
        creditType: "WALLET",
        observedAt: new Date().toISOString(),
        source: "live",
      }).success,
    ).toBe(true);
  });
});

describe("audit redaction", () => {
  it("redacts credential-like fields at any depth", () => {
    const redacted = redactMetadata({
      provider: "OPENCODE_GO",
      credential: "oc_sk_secret",
      nested: { authorization: "Bearer abc", note: "safe" },
    }) as Record<string, unknown>;

    expect(redacted.provider).toBe("OPENCODE_GO");
    expect(redacted.credential).toBe("[redacted]");
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.authorization).toBe("[redacted]");
    expect(nested.note).toBe("safe");
  });
});
