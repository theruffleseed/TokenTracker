import type { ProviderAccount, RefreshJob } from "@prisma/client";
import { prisma } from "./db";
import { getEnv } from "./env";
import {
  AdapterError,
  type AdapterErrorPayload,
  type AdapterResult,
  type CreditSnapshotInput,
  type ProviderAdapter,
} from "./providers/types";
import { createAdapter } from "./providers/registry";
import {
  creditSnapshotListSchema,
  quotaSnapshotListSchema,
  usageRecordListSchema,
} from "./providers/output";
import { decryptAccountCredential, toDbSource, toDbUnit, toDbWindow } from "./accounts";
import { recordAudit } from "./audit";
import { AppError, sanitizeMessage } from "./errors";
import { providerName } from "./providers/catalog";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MINUTES = 5;

export type RefreshOutcome =
  | { status: "skipped"; reason: string; jobId: string }
  | { status: "succeeded"; jobId: string; quotaCount: number; creditCount: number }
  | { status: "failed"; jobId: string; code: string; retryScheduled: boolean }
  | { status: "already_running"; jobId: string };

export async function enqueueRefresh(
  accountId: string,
  trigger: "SCHEDULED" | "MANUAL" | "RETRY",
): Promise<{ job: RefreshJob; existing: boolean }> {
  try {
    const job = await prisma.refreshJob.create({
      data: { providerAccountId: accountId, trigger },
    });
    return { job, existing: false };
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const existing = await prisma.refreshJob.findFirst({
        where: { providerAccountId: accountId, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { job: existing, existing: true };
    }
    throw error;
  }
}

export async function requestRefresh(
  userId: string,
  accountId: string,
): Promise<{ outcome: RefreshOutcome | null; queued: boolean; jobId: string }> {
  const account = await prisma.providerAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw new AppError("NOT_FOUND", "Provider connection not found");
  if (!account.isActive) throw new AppError("BAD_REQUEST", "This connection is paused");
  if (account.authMode !== "LIVE") {
    throw new AdapterError(
      "UNSUPPORTED",
      "This is a manual connection. Add a manual snapshot instead of refreshing.",
    );
  }

  const { job, existing } = await enqueueRefresh(account.id, "MANUAL");
  await recordAudit({
    userId,
    eventType: "REFRESH_QUEUED",
    providerAccountId: account.id,
    metadata: { jobId: job.id, trigger: "MANUAL", deduplicated: existing },
  });

  if (existing) {
    return { outcome: { status: "already_running", jobId: job.id }, queued: true, jobId: job.id };
  }

  if (!getEnv().INLINE_REFRESH) {
    return { outcome: null, queued: true, jobId: job.id };
  }

  const claimed = await claimJobById(job.id);
  if (!claimed) {
    return {
      outcome: { status: "already_running", jobId: job.id },
      queued: true,
      jobId: job.id,
    };
  }

  const outcome = await executeJob(claimed);
  return { outcome, queued: false, jobId: job.id };
}

export async function claimJobById(jobId: string): Promise<RefreshJob | null> {
  const updated = await prisma.refreshJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      attemptCount: { increment: 1 },
    },
  });
  if (updated.count === 0) return null;
  return prisma.refreshJob.findUnique({ where: { id: jobId } });
}

/**
 * Atomically claims the oldest due job. The `SKIP LOCKED` + single-flight
 * partial index allow multiple workers without duplicate refreshes.
 */
export async function claimNextJob(): Promise<RefreshJob | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "RefreshJob"
    SET "status" = 'RUNNING',
        "startedAt" = now(),
        "attemptCount" = "attemptCount" + 1,
        "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "RefreshJob"
      WHERE "status" = 'PENDING' AND "scheduledAt" <= now()
      ORDER BY "scheduledAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id"
  `;

  const id = rows[0]?.id;
  if (!id) return null;
  return prisma.refreshJob.findUnique({ where: { id } });
}

export async function enqueueDueRefreshes(): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "RefreshJob" ("id", "providerAccountId", "status", "trigger", "scheduledAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), a."id", 'PENDING', 'SCHEDULED', now(), now(), now()
    FROM "ProviderAccount" a
    WHERE a."isActive" = true
      AND a."authMode" = 'LIVE'
      AND a."status" <> 'NEEDS_ATTENTION'
      AND a."nextRefreshAt" IS NOT NULL
      AND a."nextRefreshAt" <= now()
    ON CONFLICT DO NOTHING
  `;
}

export async function recoverStuckJobs(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const updated = await prisma.refreshJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: {
      status: "PENDING",
      scheduledAt: new Date(),
      finishedAt: null,
      errorCode: "STUCK_RESET",
    },
  });
  return updated.count;
}

export async function executeJob(job: RefreshJob): Promise<RefreshOutcome> {
  const account = await prisma.providerAccount.findUnique({
    where: { id: job.providerAccountId },
  });

  if (!account) {
    await failJob(job, "NOT_CONFIGURED", "The provider connection was removed");
    return { status: "failed", jobId: job.id, code: "NOT_CONFIGURED", retryScheduled: false };
  }

  if (account.authMode === "MANUAL" || account.status === "MANUAL") {
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: "SKIPPED",
        finishedAt: new Date(),
        errorCode: "MANUAL_MODE",
      },
    });
    return { status: "skipped", reason: "Manual connections are not refreshed live", jobId: job.id };
  }

  if (!account.isActive) {
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "INACTIVE" },
    });
    return { status: "skipped", reason: "Connection is inactive", jobId: job.id };
  }

  try {
    const credential = await decryptAccountCredential(account);
    if (!credential) {
      throw new AdapterError("NOT_CONFIGURED", "No credential is stored for this connection");
    }

    const adapter = createAdapter(account.provider, {
      credential,
      accountLabel: account.accountLabel,
      planName: account.planName,
      timeoutMs: getEnv().PROVIDER_HTTP_TIMEOUT_MS,
    });

    const accountResult = await adapter.validateConnection();
    if (!accountResult.ok) {
      throw new AdapterError(accountResult.error.code, accountResult.error.message, {
        httpStatus: accountResult.error.httpStatus,
        retryAfterSeconds: accountResult.error.retryAfterSeconds,
        diagnostics: accountResult.diagnostics,
      });
    }

    const quotaResult = await adapter.getQuotaSnapshots();
    const creditResult: AdapterResult<CreditSnapshotInput[]> = adapter.getCreditSnapshots
      ? await adapter.getCreditSnapshots()
      : { ok: true, data: [] };

    if (!quotaResult.ok) throw toAdapterError(quotaResult);
    if (!creditResult.ok) throw toAdapterError(creditResult);

    let usage: Awaited<ReturnType<NonNullable<ProviderAdapter["getUsageHistory"]>>> | null = null;
    if (adapter.getUsageHistory) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      usage = await adapter.getUsageHistory(since);
    }

    const quota = quotaSnapshotListSchema.parse(quotaResult.data);
    const credits = creditSnapshotListSchema.parse(creditResult.data);
    const usageRecords = usage
      ? usage.ok
        ? usageRecordListSchema.parse(usage.data)
        : []
      : [];

    const now = new Date();
    const nextRefreshAt = new Date(now.getTime() + account.refreshIntervalMin * 60_000);
    const validated = accountResult.data;

    await prisma.$transaction(async (tx) => {
      if (quota.length > 0) {
        await tx.quotaSnapshot.createMany({
          data: quota.map((snapshot) => ({
            providerAccountId: account.id,
            windowType: toDbWindow(snapshot.window),
            unit: toDbUnit(snapshot.unit),
            limitValue: snapshot.limit,
            usedValue: snapshot.used,
            remainingValue: snapshot.remaining,
            remainingPercent: snapshot.remainingPercent,
            resetsAt: snapshot.resetsAt ? new Date(snapshot.resetsAt) : null,
            modelScope: snapshot.modelScope,
            source: toDbSource(snapshot.source),
            observedAt: new Date(snapshot.observedAt),
          })),
        });
      }

      if (credits.length > 0) {
        await tx.creditSnapshot.createMany({
          data: credits.map((credit) => ({
            providerAccountId: account.id,
            amount: credit.amount,
            currency: credit.currency,
            creditType: credit.creditType,
            source: toDbSource(credit.source),
            observedAt: new Date(credit.observedAt),
          })),
        });
      }

      for (const record of usageRecords) {
        if (record.externalId) {
          await tx.usageRecord.upsert({
            where: {
              providerAccountId_externalId: {
                providerAccountId: account.id,
                externalId: record.externalId,
              },
            },
            create: {
              providerAccountId: account.id,
              occurredAt: new Date(record.occurredAt),
              modelId: record.modelId,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              cachedTokens: record.cachedTokens,
              reasoningTokens: record.reasoningTokens,
              cost: record.cost,
              currency: record.currency,
              source: toDbSource(record.source),
              externalId: record.externalId,
            },
            update: {
              occurredAt: new Date(record.occurredAt),
              modelId: record.modelId,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              cachedTokens: record.cachedTokens,
              reasoningTokens: record.reasoningTokens,
              cost: record.cost,
              currency: record.currency,
            },
          });
        } else {
          await tx.usageRecord.create({
            data: {
              providerAccountId: account.id,
              occurredAt: new Date(record.occurredAt),
              modelId: record.modelId,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              cachedTokens: record.cachedTokens,
              reasoningTokens: record.reasoningTokens,
              cost: record.cost,
              currency: record.currency,
              source: toDbSource(record.source),
            },
          });
        }
      }

      await tx.providerAccount.update({
        where: { id: account.id },
        data: {
          status: "CONNECTED",
          lastSyncedAt: now,
          nextRefreshAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          planName: validated.planName ?? account.planName,
          accountLabel: validated.accountLabel ?? account.accountLabel,
        },
      });

      await tx.refreshJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: now,
          nextRetryAt: null,
          errorCode: null,
        },
      });
    });

    await recordAudit({
      userId: account.userId,
      eventType: "REFRESH_COMPLETED",
      providerAccountId: account.id,
      metadata: {
        provider: account.provider,
        quotaCount: quota.length,
        creditCount: credits.length,
        usageCount: usageRecords.length,
      },
    });

    return {
      status: "succeeded",
      jobId: job.id,
      quotaCount: quota.length,
      creditCount: credits.length,
    };
  } catch (error) {
    const adapterError =
      error instanceof AdapterError
        ? error
        : new AdapterError("UNKNOWN", sanitizeMessage(error));

    const code = adapterError.code;
    const needsAttention = ["INVALID_CREDENTIALS", "EXPIRED_CREDENTIALS", "FORBIDDEN", "UNSUPPORTED", "NOT_CONFIGURED"].includes(code);
    const retryable = ["RATE_LIMITED", "TIMEOUT", "NETWORK_ERROR", "PROVIDER_UNAVAILABLE", "PROVIDER_ERROR", "MALFORMED_RESPONSE"].includes(code);
    const retryScheduled = retryable && job.attemptCount < MAX_ATTEMPTS;

    const now = new Date();
    const normalNext = new Date(now.getTime() + account.refreshIntervalMin * 60_000);
    const retryAt = retryScheduled
      ? new Date(
          now.getTime() +
            retryDelayMinutes(job.attemptCount, adapterError.retryAfterSeconds) * 60_000,
        )
      : null;

    await prisma.providerAccount.update({
      where: { id: account.id },
      data: {
        status: needsAttention ? "NEEDS_ATTENTION" : "ERROR",
        lastErrorCode: code,
        lastErrorMessage: sanitizeMessage(adapterError.message, 500),
        nextRefreshAt:
          retryAt && retryAt.getTime() < normalNext.getTime() ? retryAt : normalNext,
      },
    });

    await prisma.refreshJob.update({
      where: { id: job.id },
      data: retryScheduled
        ? {
            status: "PENDING",
            scheduledAt: retryAt!,
            nextRetryAt: retryAt,
            startedAt: null,
            finishedAt: null,
            errorCode: code,
          }
        : {
            status: "FAILED",
            finishedAt: now,
            nextRetryAt: null,
            errorCode: code,
          },
    });

    await recordAudit({
      userId: account.userId,
      eventType: "REFRESH_FAILED",
      providerAccountId: account.id,
      metadata: {
        provider: account.provider,
        code,
        attempt: job.attemptCount,
        retryScheduled,
      },
    });

    return {
      status: "failed",
      jobId: job.id,
      code,
      retryScheduled,
    };
  }
}

function retryDelayMinutes(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(60, Math.max(1, Math.ceil(retryAfterSeconds / 60)));
  }
  return Math.min(60, RETRY_BASE_MINUTES * 2 ** Math.max(0, attempt - 1));
}

function toAdapterError(result: { error: AdapterErrorPayload }): AdapterError {
  return new AdapterError(result.error.code, result.error.message, {
    httpStatus: result.error.httpStatus,
    retryAfterSeconds: result.error.retryAfterSeconds,
    diagnostics: result.error.diagnostics,
  });
}

async function failJob(job: RefreshJob, code: string, message: string): Promise<void> {
  await prisma.refreshJob.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorCode: code,
    },
  });
  console.warn(`[refresh] job ${job.id} failed: ${code} ${sanitizeMessage(message)}`);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export function refreshSupportLabel(account: ProviderAccount): string {
  if (account.authMode === "MANUAL") return "Manual";
  return providerName(account.provider);
}
