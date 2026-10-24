import type { ProviderAccount } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { recordAudit } from "./audit";
import { credentialHint, encryptSecret } from "./crypto";
import { getEnv } from "./env";
import { readAccountCredential } from "./credentials";
import type { ProviderKey } from "./schemas";
import { deriveQuota } from "./providers/parsing";
import type { CreditTypeKey, QuotaSnapshotInput } from "./providers/types";

export async function getOwnedAccount(userId: string, accountId: string): Promise<ProviderAccount> {
  const account = await prisma.providerAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw new AppError("NOT_FOUND", "Provider connection not found");
  return account;
}

export async function createAccount(input: {
  userId: string;
  provider: ProviderKey;
  displayName: string;
  authMode: "LIVE" | "MANUAL";
  credential?: string;
  planName?: string;
  accountLabel?: string;
  refreshIntervalMin?: number;
}): Promise<ProviderAccount> {
  const env = getEnv();
  const interval = input.refreshIntervalMin ?? env.REFRESH_DEFAULT_INTERVAL_MINUTES;
  const now = new Date();
  const isLive = input.authMode === "LIVE";

  if (isLive && !input.credential) {
    throw new AppError("BAD_REQUEST", "A live connection requires an API key");
  }

  const envelope = isLive && input.credential ? encryptSecret(input.credential) : null;

  try {
    const account = await prisma.providerAccount.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        displayName: input.displayName,
        authMode: input.authMode,
        planName: input.planName || null,
        accountLabel: input.accountLabel || null,
        status: isLive ? "NEVER_CONNECTED" : "MANUAL",
        credentialCiphertext: envelope?.ciphertext ?? null,
        credentialIv: envelope?.iv ?? null,
        credentialTag: envelope?.tag ?? null,
        credentialKeyVersion: envelope?.keyVersion ?? null,
        credentialHint:
          isLive && input.credential ? credentialHint(input.credential) : null,
        refreshIntervalMin: interval,
        nextRefreshAt: isLive ? new Date(now.getTime() + interval * 60_000) : null,
      },
    });

    await recordAudit({
      userId: input.userId,
      eventType: "PROVIDER_CONNECTED",
      providerAccountId: account.id,
      metadata: {
        provider: input.provider,
        authMode: input.authMode,
        displayName: input.displayName,
      },
    });

    return account;
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new AppError("CONFLICT", "You already have a connection with that name");
    }
    throw error;
  }
}

export async function updateAccount(
  userId: string,
  accountId: string,
  input: {
    displayName?: string;
    planName?: string | null;
    accountLabel?: string | null;
    refreshIntervalMin?: number;
    isActive?: boolean;
  },
): Promise<ProviderAccount> {
  await getOwnedAccount(userId, accountId);

  try {
    const account = await prisma.providerAccount.update({
      where: { id: accountId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.planName !== undefined ? { planName: input.planName } : {}),
        ...(input.accountLabel !== undefined ? { accountLabel: input.accountLabel } : {}),
        ...(input.refreshIntervalMin !== undefined
          ? { refreshIntervalMin: input.refreshIntervalMin }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await recordAudit({
      userId,
      eventType: "PROVIDER_UPDATED",
      providerAccountId: accountId,
      metadata: { fields: Object.keys(input) },
    });

    return account;
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new AppError("CONFLICT", "You already have a connection with that name");
    }
    throw error;
  }
}

export async function replaceCredential(
  userId: string,
  accountId: string,
  credential: string,
): Promise<void> {
  const account = await getOwnedAccount(userId, accountId);
  if (account.authMode !== "LIVE") {
    throw new AppError("BAD_REQUEST", "Manual connections do not store credentials");
  }

  const envelope = encryptSecret(credential);
  await prisma.providerAccount.update({
    where: { id: accountId },
    data: {
      credentialCiphertext: envelope.ciphertext,
      credentialIv: envelope.iv,
      credentialTag: envelope.tag,
      credentialKeyVersion: envelope.keyVersion,
      credentialHint: credentialHint(credential),
      status: "NEVER_CONNECTED",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncedAt: null,
      nextRefreshAt: new Date(Date.now() + account.refreshIntervalMin * 60_000),
    },
  });

  await recordAudit({
    userId,
    eventType: "CREDENTIAL_UPDATED",
    providerAccountId: accountId,
    metadata: { hint: credentialHint(credential) },
  });
}

export async function disconnectAccount(userId: string, accountId: string): Promise<void> {
  const account = await getOwnedAccount(userId, accountId);

  // Write the audit event first; deleting the account nulls the FK rather than
  // removing the event, and an insert after deletion would violate the FK.
  await recordAudit({
    userId,
    eventType: "PROVIDER_DISCONNECTED",
    providerAccountId: accountId,
    metadata: { provider: account.provider, displayName: account.displayName },
  });

  await prisma.providerAccount.delete({ where: { id: accountId } });
}

export async function addManualQuota(
  userId: string,
  accountId: string,
  input: {
    windowType: QuotaSnapshotInput["window"];
    unit: QuotaSnapshotInput["unit"];
    limitValue?: number | null;
    usedValue?: number | null;
    remainingValue?: number | null;
    remainingPercent?: number | null;
    resetsAt?: string | null;
    modelScope?: string | null;
    observedAt?: string;
  },
): Promise<void> {
  const account = await getOwnedAccount(userId, accountId);

  const derived = deriveQuota({
    limit: input.limitValue ?? null,
    used: input.usedValue ?? null,
    remaining: input.remainingValue ?? null,
    remainingPercent: input.remainingPercent ?? null,
  });

  await prisma.quotaSnapshot.create({
    data: {
      providerAccountId: account.id,
      windowType: toDbWindow(input.windowType),
      unit: toDbUnit(input.unit),
      limitValue: derived.limit,
      usedValue: derived.used,
      remainingValue: derived.remaining,
      remainingPercent: derived.remainingPercent,
      resetsAt: input.resetsAt ? new Date(input.resetsAt) : null,
      modelScope: input.modelScope || null,
      source: "MANUAL",
      observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
    },
  });

  if (account.authMode === "MANUAL") {
    await prisma.providerAccount.update({
      where: { id: account.id },
      data: { status: "MANUAL", lastErrorCode: null, lastErrorMessage: null },
    });
  }

  await recordAudit({
    userId,
    eventType: "MANUAL_SNAPSHOT_ADDED",
    providerAccountId: account.id,
    metadata: {
      kind: "quota",
      windowType: input.windowType,
      unit: input.unit,
      modelScope: input.modelScope ?? null,
    },
  });
}

export async function addManualCredit(
  userId: string,
  accountId: string,
  input: {
    amount: number;
    currency: string;
    creditType: CreditTypeKey;
    observedAt?: string;
  },
): Promise<void> {
  const account = await getOwnedAccount(userId, accountId);

  await prisma.creditSnapshot.create({
    data: {
      providerAccountId: account.id,
      amount: input.amount,
      currency: input.currency,
      creditType: input.creditType,
      source: "MANUAL",
      observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
    },
  });

  if (account.authMode === "MANUAL") {
    await prisma.providerAccount.update({
      where: { id: account.id },
      data: { status: "MANUAL", lastErrorCode: null, lastErrorMessage: null },
    });
  }

  await recordAudit({
    userId,
    eventType: "MANUAL_SNAPSHOT_ADDED",
    providerAccountId: account.id,
    metadata: {
      kind: "credit",
      creditType: input.creditType,
      currency: input.currency,
    },
  });
}

/** Used by the refresh service; keeps enum mapping in one place. */
export function toDbWindow(value: QuotaSnapshotInput["window"]) {
  return {
    rolling_5h: "ROLLING_5H",
    daily: "DAILY",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
    other: "OTHER",
  }[value] as "ROLLING_5H" | "DAILY" | "WEEKLY" | "MONTHLY" | "OTHER";
}

export function toDbUnit(value: QuotaSnapshotInput["unit"]) {
  return {
    tokens: "TOKENS",
    requests: "REQUESTS",
    credits: "CREDITS",
    usd: "USD",
    percent: "PERCENT",
    provider_defined: "PROVIDER_DEFINED",
  }[value] as "TOKENS" | "REQUESTS" | "CREDITS" | "USD" | "PERCENT" | "PROVIDER_DEFINED";
}

export function toDbSource(value: QuotaSnapshotInput["source"]) {
  return {
    live: "LIVE",
    manual: "MANUAL",
    cached: "CACHED",
    estimated: "ESTIMATED",
  }[value] as "LIVE" | "MANUAL" | "CACHED" | "ESTIMATED";
}

export async function decryptAccountCredential(account: ProviderAccount): Promise<string | null> {
  return readAccountCredential(account);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
