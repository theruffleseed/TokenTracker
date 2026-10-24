import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addManualCredit,
  addManualQuota,
  createAccount,
  disconnectAccount,
  getOwnedAccount,
} from "@/lib/accounts";
import { getAccountDetail, getDashboardSummary } from "@/lib/dashboard";
import { createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("provider accounts and manual snapshots (database)", () => {
  it("stores manual quota, derives remaining, and labels the source", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Harbor",
      authMode: "MANUAL",
      planName: "Office Pass",
    });

    await addManualQuota(user.id, account.id, {
      windowType: "weekly",
      unit: "usd",
      limitValue: 35,
      usedValue: 10,
      resetsAt: "2026-11-01T00:00:00.000Z",
      modelScope: null,
    });

    await addManualCredit(user.id, account.id, {
      amount: 12.5,
      currency: "USD",
      creditType: "WALLET",
    });

    const summary = await getDashboardSummary(user.id);
    expect(summary.accounts).toHaveLength(1);

    const view = summary.accounts[0]!;
    expect(view.authMode).toBe("MANUAL");
    expect(view.status).toBe("MANUAL");
    expect(view.quota).toHaveLength(1);
    expect(view.quota[0]).toMatchObject({
      window: "weekly",
      unit: "usd",
      limit: 35,
      used: 10,
      remaining: 25,
      remainingPercent: 71.4286,
      source: "manual",
    });
    expect(view.credits[0]).toMatchObject({ amount: 12.5, creditType: "WALLET" });
    expect(view.lowest?.percent).toBeCloseTo(71.4286, 3);
    expect(view.freshness.kind).toBe("manual");

    const detail = await getAccountDetail(user.id, account.id);
    expect(detail?.quotaHistory).toHaveLength(1);
    expect(detail?.audit.some((event) => event.eventType === "MANUAL_SNAPSHOT_ADDED")).toBe(true);
  });

  it("never exposes another user's account", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const account = await createAccount({
      userId: owner.id,
      provider: "RIVER_AI",
      displayName: "River",
      authMode: "MANUAL",
    });

    await expect(getOwnedAccount(stranger.id, account.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await getAccountDetail(stranger.id, account.id)).toBeNull();
  });

  it("persists encrypted credentials without plaintext columns", async () => {
    const user = await createTestUser();
    const secret = "thk_live_super_secret_value_1234567890";
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Live Harbor",
      authMode: "LIVE",
      credential: secret,
    });

    const stored = await prisma.providerAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.credentialCiphertext).toBeTruthy();
    expect(stored.credentialCiphertext).not.toContain(secret);
    expect(stored.credentialIv).toBeTruthy();
    expect(stored.credentialTag).toBeTruthy();
    expect(stored.credentialKeyVersion).toBe(1);
    expect(stored.credentialHint).toBe("…7890");
    expect(stored.status).toBe("NEVER_CONNECTED");
  });

  it("cascades snapshots when a connection is disconnected", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "COMMANDCODE",
      displayName: "Command",
      authMode: "MANUAL",
    });

    await addManualQuota(user.id, account.id, {
      windowType: "weekly",
      unit: "percent",
      remainingPercent: 42,
    });

    await disconnectAccount(user.id, account.id);

    expect(await prisma.providerAccount.count()).toBe(0);
    expect(await prisma.quotaSnapshot.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { eventType: "PROVIDER_DISCONNECTED" } })).toBe(1);
  });
});
