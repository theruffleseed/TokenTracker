import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeExpiredData } from "@/lib/retention";
import { createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("retention (database)", () => {
  it("deletes observations older than the user's window", async () => {
    const user = await createTestUser();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        quotaRetentionDays: 7,
        usageRetentionDays: 7,
        auditRetentionDays: 7,
      },
    });

    const account = await prisma.providerAccount.create({
      data: {
        userId: user.id,
        provider: "TOKENHARBOR",
        displayName: "Old data",
        authMode: "MANUAL",
        status: "MANUAL",
      },
    });

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    await prisma.quotaSnapshot.createMany({
      data: [
        {
          providerAccountId: account.id,
          windowType: "MONTHLY",
          unit: "USD",
          remainingValue: 5,
          source: "MANUAL",
          observedAt: old,
        },
        {
          providerAccountId: account.id,
          windowType: "MONTHLY",
          unit: "USD",
          remainingValue: 6,
          source: "MANUAL",
          observedAt: fresh,
        },
      ],
    });

    await prisma.creditSnapshot.create({
      data: {
        providerAccountId: account.id,
        amount: 5,
        currency: "USD",
        creditType: "WALLET",
        source: "MANUAL",
        observedAt: old,
      },
    });

    await prisma.usageRecord.create({
      data: {
        providerAccountId: account.id,
        occurredAt: old,
        source: "MANUAL",
        externalId: "old-usage",
      },
    });

    await prisma.auditEvent.create({
      data: { userId: user.id, eventType: "SETTINGS_UPDATED", createdAt: old },
    });

    await prisma.refreshJob.create({
      data: {
        providerAccountId: account.id,
        status: "SUCCEEDED",
        scheduledAt: old,
        finishedAt: old,
        createdAt: old,
      },
    });

    const result = await purgeExpiredData();

    expect(result.quotaSnapshots).toBe(1);
    expect(result.creditSnapshots).toBe(1);
    expect(result.usageRecords).toBe(1);
    expect(result.auditEvents).toBe(1);
    expect(result.refreshJobs).toBe(1);

    expect(
      await prisma.quotaSnapshot.count({ where: { providerAccountId: account.id } }),
    ).toBe(1);
  });
});
