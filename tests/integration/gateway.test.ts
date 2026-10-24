import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addManualCredit, addManualQuota, createAccount } from "@/lib/accounts";
import { recordGatewayUsage } from "@/lib/gateway/record";
import { createTestUser, resetDatabase } from "./helpers";

const PRICE = {
  input: 1,
  cachedInput: 0.1,
  cacheWrite: 1,
  output: 2,
  free: false,
};

beforeEach(async () => {
  await resetDatabase();
});

describe("gateway usage persistence (database)", () => {
  it("records usage and re-derives the TokenHarbor balance and weekly Pass window", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Harbor",
      authMode: "LIVE",
      credential: "thk_live_test_key",
      planName: "Office Pass",
    });

    const anchorAt = new Date(Date.now() - 60_000);
    await addManualCredit(user.id, account.id, {
      amount: 20,
      currency: "USD",
      creditType: "INCLUDED_ALLOWANCE",
      observedAt: anchorAt.toISOString(),
    });
    await addManualQuota(user.id, account.id, {
      windowType: "weekly",
      unit: "percent",
      remainingPercent: 90,
      modelScope: "Paid models",
      observedAt: anchorAt.toISOString(),
    });

    // 1M input + 1M output = $3.00 at the injected list price.
    const now = new Date();
    const result = await recordGatewayUsage(
      account,
      {
        modelId: "test-model",
        inputTokens: 1_000_000,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: null,
      },
      { now, price: PRICE },
    );

    expect(result?.cost).toBeCloseTo(3, 8);

    const usage = await prisma.usageRecord.findMany({ where: { providerAccountId: account.id } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      source: "ESTIMATED",
      modelId: "test-model",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      currency: "USD",
    });

    const credits = await prisma.creditSnapshot.findMany({
      where: { providerAccountId: account.id, source: "ESTIMATED" },
    });
    expect(credits).toHaveLength(1);
    expect(Number(credits[0]!.amount)).toBeCloseTo(17, 8);
    expect(credits[0]!.creditType).toBe("INCLUDED_ALLOWANCE");

    // Office = $8.75/week. 10% used anchor = $0.875, plus $3.00 = $3.875 used.
    const quota = await prisma.quotaSnapshot.findMany({
      where: { providerAccountId: account.id, source: "ESTIMATED" },
    });
    expect(quota).toHaveLength(1);
    expect(Number(quota[0]!.limitValue)).toBeCloseTo(8.75, 8);
    expect(Number(quota[0]!.usedValue)).toBeCloseTo(3.875, 8);
    expect(Number(quota[0]!.remainingPercent)).toBeCloseTo((4.875 / 8.75) * 100, 4);
    expect(quota[0]!.modelScope).toBe("Paid models");
  });

  it("re-bases after a new manual snapshot instead of double-charging", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "RIVER_AI",
      displayName: "River",
      authMode: "LIVE",
      credential: "rv_test_key",
    });

    const firstAt = new Date(Date.now() - 120_000);
    await addManualCredit(user.id, account.id, {
      amount: 10,
      currency: "USD",
      creditType: "REWARD",
      observedAt: firstAt.toISOString(),
    });

    await recordGatewayUsage(
      account,
      { modelId: "m", inputTokens: 1_000_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null },
      { now: new Date(Date.now() - 60_000), price: PRICE },
    );

    // The user records the vendor's actual balance after the first request.
    const secondAt = new Date(Date.now() - 30_000);
    await addManualCredit(user.id, account.id, {
      amount: 9,
      currency: "USD",
      creditType: "REWARD",
      observedAt: secondAt.toISOString(),
    });

    await recordGatewayUsage(
      account,
      { modelId: "m", inputTokens: 1_000_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null },
      { now: new Date(), price: PRICE },
    );

    const latest = await prisma.creditSnapshot.findFirst({
      where: { providerAccountId: account.id, source: "ESTIMATED" },
      orderBy: { observedAt: "desc" },
    });
    // $9.00 anchor minus only the $1.00 spent after it.
    expect(Number(latest?.amount)).toBeCloseTo(8, 8);
    expect(latest?.creditType).toBe("REWARD");
  });

  it("does not invent a weekly percentage when the Pass tier is unknown", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Harbor wallet",
      authMode: "LIVE",
      credential: "thk_live_test_key",
    });
    await addManualCredit(user.id, account.id, {
      amount: 5,
      currency: "USD",
      creditType: "WALLET",
    });

    await recordGatewayUsage(
      account,
      { modelId: "m", inputTokens: 1_000_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null },
      { now: new Date(), price: PRICE },
    );

    expect(await prisma.quotaSnapshot.count({ where: { providerAccountId: account.id } })).toBe(0);
    const estimate = await prisma.creditSnapshot.findFirst({
      where: { providerAccountId: account.id, source: "ESTIMATED" },
    });
    expect(Number(estimate?.amount)).toBeCloseTo(4, 8);
  });

  it("does not drain a wallet when a Pass window is tracked without a value anchor", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Harbor pass",
      authMode: "LIVE",
      credential: "thk_live_test_key",
      planName: "Office Pass",
    });
    await addManualCredit(user.id, account.id, {
      amount: 50,
      currency: "USD",
      creditType: "WALLET",
    });
    await addManualQuota(user.id, account.id, {
      windowType: "weekly",
      unit: "percent",
      remainingPercent: 80,
      modelScope: "Paid models",
    });

    await recordGatewayUsage(
      account,
      { modelId: "m", inputTokens: 2_000_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null },
      { now: new Date(), price: PRICE },
    );

    expect(
      await prisma.creditSnapshot.count({
        where: { providerAccountId: account.id, source: "ESTIMATED" },
      }),
    ).toBe(0);

    const quota = await prisma.quotaSnapshot.findFirst({
      where: { providerAccountId: account.id, source: "ESTIMATED" },
    });
    // 20% of $8.75 = $1.75 used, plus $2.00 spend = $3.75 used.
    expect(Number(quota?.usedValue)).toBeCloseTo(3.75, 8);
  });
});
