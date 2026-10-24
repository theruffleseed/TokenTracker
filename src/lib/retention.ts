import { prisma } from "./db";

export interface PurgeResult {
  quotaSnapshots: number;
  creditSnapshots: number;
  usageRecords: number;
  auditEvents: number;
  refreshJobs: number;
  sessions: number;
}

/**
 * Applies per-user retention windows. Safe to run repeatedly and concurrently;
 * deletes are idempotent. Counts are approximate for the scheduler's logs.
 */
export async function purgeExpiredData(): Promise<PurgeResult> {
  const [quotaSnapshots, creditSnapshots, usageRecords, auditEvents, refreshJobs, sessions] =
    await Promise.all([
      prisma.$executeRaw`
        DELETE FROM "QuotaSnapshot" q
        USING "ProviderAccount" a, "User" u
        WHERE q."providerAccountId" = a."id"
          AND a."userId" = u."id"
          AND q."observedAt" < now() - make_interval(days => u."quotaRetentionDays")
      `,
      prisma.$executeRaw`
        DELETE FROM "CreditSnapshot" c
        USING "ProviderAccount" a, "User" u
        WHERE c."providerAccountId" = a."id"
          AND a."userId" = u."id"
          AND c."observedAt" < now() - make_interval(days => u."quotaRetentionDays")
      `,
      prisma.$executeRaw`
        DELETE FROM "UsageRecord" r
        USING "ProviderAccount" a, "User" u
        WHERE r."providerAccountId" = a."id"
          AND a."userId" = u."id"
          AND r."occurredAt" < now() - make_interval(days => u."usageRetentionDays")
      `,
      prisma.$executeRaw`
        DELETE FROM "AuditEvent" e
        USING "User" u
        WHERE e."userId" = u."id"
          AND e."createdAt" < now() - make_interval(days => u."auditRetentionDays")
      `,
      prisma.$executeRaw`
        DELETE FROM "RefreshJob"
        WHERE "createdAt" < now() - interval '30 days'
          AND "status" NOT IN ('PENDING', 'RUNNING')
      `,
      prisma.$executeRaw`
        DELETE FROM "Session"
        WHERE "expiresAt" < now()
      `,
    ]);

  return {
    quotaSnapshots,
    creditSnapshots,
    usageRecords,
    auditEvents,
    refreshJobs,
    sessions,
  };
}

/** Runs retention only when another worker isn't already doing it. */
export async function purgeExpiredDataWithLock(): Promise<PurgeResult | null> {
  const lock = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(742901) AS locked
  `;

  if (!lock[0]?.locked) return null;

  try {
    return await purgeExpiredData();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(742901)`;
  }
}
