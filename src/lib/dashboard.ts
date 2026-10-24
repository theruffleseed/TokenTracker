import type {
  CreditSnapshot,
  ProviderAccount,
  QuotaSnapshot,
  RefreshJob,
  AuditEvent,
} from "@prisma/client";
import { prisma } from "./db";
import { PROVIDER_CATALOG } from "./providers/catalog";
import type { ProviderKey, QuotaUnitKey, QuotaWindowKey } from "./schemas";
import {
  computeFreshness,
  lowestRemainingPercent,
  WINDOW_PRIORITY,
  type Freshness,
} from "./quota";

const WINDOW_FROM_DB = {
  ROLLING_5H: "rolling_5h",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  OTHER: "other",
} as const satisfies Record<string, QuotaWindowKey>;

const UNIT_FROM_DB = {
  TOKENS: "tokens",
  REQUESTS: "requests",
  CREDITS: "credits",
  USD: "usd",
  PERCENT: "percent",
  PROVIDER_DEFINED: "provider_defined",
} as const satisfies Record<string, QuotaUnitKey>;

const SOURCE_FROM_DB = {
  LIVE: "live",
  MANUAL: "manual",
  CACHED: "cached",
  ESTIMATED: "estimated",
} as const;

export interface QuotaView {
  id: string;
  window: QuotaWindowKey;
  unit: QuotaUnitKey;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  modelScope: string | null;
  source: "live" | "manual" | "cached" | "estimated";
  observedAt: string;
}

export interface CreditView {
  id: string;
  amount: number;
  currency: string;
  creditType: string;
  source: "live" | "manual" | "cached" | "estimated";
  observedAt: string;
}

export interface JobView {
  id: string;
  status: string;
  trigger: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attemptCount: number;
  errorCode: string | null;
}

export interface AuditView {
  id: string;
  eventType: string;
  createdAt: string;
  metadata: unknown;
}

export interface AccountView {
  id: string;
  provider: ProviderKey;
  providerSlug: string;
  providerName: string;
  vendor: string;
  docsUrl: string;
  displayName: string;
  planName: string | null;
  accountLabel: string | null;
  status: string;
  authMode: "LIVE" | "MANUAL";
  refreshIntervalMin: number;
  lastSyncedAt: string | null;
  nextRefreshAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  credentialHint: string | null;
  isActive: boolean;
  createdAt: string;
  quota: QuotaView[];
  credits: CreditView[];
  lowest: { percent: number; window: QuotaWindowKey; modelScope: string | null } | null;
  freshness: Freshness;
  latestObservationAt: string | null;
  capabilities: (typeof PROVIDER_CATALOG)[ProviderKey]["capabilities"];
  capabilityNotes: string[];
  authLabel: string;
  job: JobView | null;
}

export interface AccountDetail extends AccountView {
  quotaHistory: QuotaView[];
  creditHistory: CreditView[];
  jobs: JobView[];
  audit: AuditView[];
}

type AccountWithRelations = ProviderAccount & {
  quotaSnapshots: QuotaSnapshot[];
  creditSnapshots: CreditSnapshot[];
  refreshJobs?: RefreshJob[];
};

const accountInclude = {
  quotaSnapshots: { orderBy: { observedAt: "desc" as const }, take: 300 },
  creditSnapshots: { orderBy: { observedAt: "desc" as const }, take: 100 },
  refreshJobs: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

function toNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const numeric = Number(value.toString());
  return Number.isFinite(numeric) ? numeric : null;
}

export function mapQuota(row: QuotaSnapshot): QuotaView {
  return {
    id: row.id,
    window: WINDOW_FROM_DB[row.windowType],
    unit: UNIT_FROM_DB[row.unit],
    limit: toNumber(row.limitValue),
    used: toNumber(row.usedValue),
    remaining: toNumber(row.remainingValue),
    remainingPercent: toNumber(row.remainingPercent),
    resetsAt: row.resetsAt?.toISOString() ?? null,
    modelScope: row.modelScope,
    source: SOURCE_FROM_DB[row.source],
    observedAt: row.observedAt.toISOString(),
  };
}

export function mapCredit(row: CreditSnapshot): CreditView {
  return {
    id: row.id,
    amount: toNumber(row.amount) ?? 0,
    currency: row.currency,
    creditType: row.creditType,
    source: SOURCE_FROM_DB[row.source],
    observedAt: row.observedAt.toISOString(),
  };
}

function mapJob(row: RefreshJob): JobView {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    attemptCount: row.attemptCount,
    errorCode: row.errorCode,
  };
}

function mapAudit(row: AuditEvent): AuditView {
  return {
    id: row.id,
    eventType: row.eventType,
    createdAt: row.createdAt.toISOString(),
    metadata: row.metadata,
  };
}

function latestByScope(rows: QuotaSnapshot[]): QuotaSnapshot[] {
  const seen = new Set<string>();
  const out: QuotaSnapshot[] = [];
  for (const row of rows) {
    const key = `${row.windowType}|${row.modelScope ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out.sort((a, b) => {
    const priority =
      WINDOW_PRIORITY[WINDOW_FROM_DB[a.windowType]] -
      WINDOW_PRIORITY[WINDOW_FROM_DB[b.windowType]];
    if (priority !== 0) return priority;
    return (a.modelScope ?? "").localeCompare(b.modelScope ?? "");
  });
}

function latestCredits(rows: CreditSnapshot[]): CreditSnapshot[] {
  const seen = new Set<string>();
  const out: CreditSnapshot[] = [];
  for (const row of rows) {
    const key = `${row.creditType}|${row.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function observationTimes(account: AccountWithRelations): {
  latestAt: string | null;
  latestSource: "live" | "manual" | "cached" | "estimated" | null;
} {
  const candidates: Array<{ at: Date; source: "live" | "manual" | "cached" | "estimated" }> = [
    ...account.quotaSnapshots.map((row) => ({
      at: row.observedAt,
      source: SOURCE_FROM_DB[row.source],
    })),
    ...account.creditSnapshots.map((row) => ({
      at: row.observedAt,
      source: SOURCE_FROM_DB[row.source],
    })),
  ];
  candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
  const newest = candidates[0];
  return {
    latestAt: newest?.at.toISOString() ?? null,
    latestSource: newest?.source ?? null,
  };
}

export function mapAccount(account: AccountWithRelations): AccountView {
  const catalog = PROVIDER_CATALOG[account.provider];
  const quotaRows = latestByScope(account.quotaSnapshots);
  const quota = quotaRows.map(mapQuota);
  const credits = latestCredits(account.creditSnapshots).map(mapCredit);
  const observation = observationTimes(account);
  const hasError =
    account.status === "ERROR" || account.status === "NEEDS_ATTENTION" || !!account.lastErrorCode;

  const freshness = computeFreshness({
    lastLiveSyncAt: account.lastSyncedAt,
    latestObservationAt: observation.latestAt,
    latestSource:
      observation.latestSource ?? (account.authMode === "MANUAL" ? "manual" : null),
    refreshIntervalMin: account.refreshIntervalMin,
    hasError,
  });

  return {
    id: account.id,
    provider: account.provider,
    providerSlug: catalog.slug,
    providerName: catalog.name,
    vendor: catalog.vendor,
    docsUrl: catalog.docsUrl,
    displayName: account.displayName,
    planName: account.planName,
    accountLabel: account.accountLabel,
    status: account.status,
    authMode: account.authMode,
    refreshIntervalMin: account.refreshIntervalMin,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    nextRefreshAt: account.nextRefreshAt?.toISOString() ?? null,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    credentialHint: account.credentialHint,
    isActive: account.isActive,
    createdAt: account.createdAt.toISOString(),
    quota,
    credits,
    lowest: lowestRemainingPercent(quota),
    freshness,
    latestObservationAt: observation.latestAt,
    capabilities: catalog.capabilities,
    capabilityNotes: catalog.capabilityNotes,
    authLabel: catalog.authLabel,
    job: account.refreshJobs?.[0] ? mapJob(account.refreshJobs[0]) : null,
  };
}

export async function listAccounts(userId: string): Promise<AccountView[]> {
  const accounts = await prisma.providerAccount.findMany({
    where: { userId },
    include: accountInclude,
    orderBy: { createdAt: "asc" },
  });

  return accounts.map(mapAccount);
}

export async function getAccountDetail(
  userId: string,
  accountId: string,
): Promise<AccountDetail | null> {
  const account = await prisma.providerAccount.findFirst({
    where: { id: accountId, userId },
    include: {
      quotaSnapshots: { orderBy: { observedAt: "desc" }, take: 300 },
      creditSnapshots: { orderBy: { observedAt: "desc" }, take: 100 },
      refreshJobs: { orderBy: { createdAt: "desc" }, take: 20 },
      auditEvents: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!account) return null;

  const base = mapAccount(account);
  return {
    ...base,
    quotaHistory: account.quotaSnapshots.map(mapQuota),
    creditHistory: account.creditSnapshots.map(mapCredit),
    jobs: account.refreshJobs.map(mapJob),
    audit: account.auditEvents.map(mapAudit),
  };
}

export async function getDashboardSummary(userId: string): Promise<{
  accounts: AccountView[];
  totals: {
    accounts: number;
    healthy: number;
    needsAttention: number;
    manual: number;
    neverSynced: number;
    lowest: number | null;
  };
}> {
  const accounts = await listAccounts(userId);
  const lowestValues = accounts
    .map((account) => account.lowest?.percent)
    .filter((value): value is number => value !== undefined && value !== null);

  return {
    accounts,
    totals: {
      accounts: accounts.length,
      healthy: accounts.filter((account) => account.freshness.kind === "live").length,
      needsAttention: accounts.filter(
        (account) =>
          account.freshness.kind === "error" || account.freshness.kind === "stale",
      ).length,
      manual: accounts.filter((account) => account.authMode === "MANUAL").length,
      neverSynced: accounts.filter((account) => account.freshness.kind === "never").length,
      lowest: lowestValues.length ? Math.min(...lowestValues) : null,
    },
  };
}
