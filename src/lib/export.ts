import { prisma } from "./db";
import { recordAudit } from "./audit";

export interface ExportBundle {
  exportedAt: string;
  user: { email: string; displayName: string | null; timezone: string };
  accounts: Array<Record<string, unknown>>;
}

/** Builds a portable export with no credential material or session tokens. */
export async function buildExport(userId: string): Promise<ExportBundle> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, displayName: true, timezone: true },
  });

  const accounts = await prisma.providerAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      displayName: true,
      planName: true,
      accountLabel: true,
      authMode: true,
      status: true,
      refreshIntervalMin: true,
      lastSyncedAt: true,
      nextRefreshAt: true,
      createdAt: true,
      quotaSnapshots: {
        orderBy: { observedAt: "desc" },
        select: {
          windowType: true,
          unit: true,
          limitValue: true,
          usedValue: true,
          remainingValue: true,
          remainingPercent: true,
          resetsAt: true,
          modelScope: true,
          source: true,
          observedAt: true,
        },
      },
      creditSnapshots: {
        orderBy: { observedAt: "desc" },
        select: {
          amount: true,
          currency: true,
          creditType: true,
          source: true,
          observedAt: true,
        },
      },
      usageRecords: {
        orderBy: { occurredAt: "desc" },
        take: 5000,
        select: {
          occurredAt: true,
          modelId: true,
          inputTokens: true,
          outputTokens: true,
          cachedTokens: true,
          reasoningTokens: true,
          cost: true,
          currency: true,
          source: true,
          externalId: true,
        },
      },
    },
  });

  await recordAudit({
    userId,
    eventType: "DATA_EXPORTED",
    metadata: { format: "json", accounts: accounts.length },
  });

  return {
    exportedAt: new Date().toISOString(),
    user,
    accounts: accounts.map((account) => ({
      ...account,
      quotaSnapshots: account.quotaSnapshots.map(serializeDecimals),
      creditSnapshots: account.creditSnapshots.map(serializeDecimals),
      usageRecords: account.usageRecords.map(serializeDecimals),
    })),
  };
}

function serializeDecimals<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (
      value !== null &&
      typeof value === "object" &&
      "toNumber" in value &&
      typeof (value as { toNumber?: unknown }).toNumber === "function"
    ) {
      out[key] = (value as { toNumber(): number }).toNumber();
    }
  }
  return out;
}

export function buildUsageCsv(bundle: ExportBundle): string {
  const header = [
    "account",
    "provider",
    "occurred_at",
    "model",
    "input_tokens",
    "output_tokens",
    "cached_tokens",
    "reasoning_tokens",
    "cost",
    "currency",
    "source",
    "external_id",
  ];

  const rows: string[][] = [];
  for (const account of bundle.accounts) {
    const usage = (account.usageRecords as Array<Record<string, unknown>>) ?? [];
    for (const record of usage) {
      rows.push([
        String(account.displayName ?? ""),
        String(account.provider ?? ""),
        String(record.occurredAt instanceof Date ? record.occurredAt.toISOString() : record.occurredAt ?? ""),
        String(record.modelId ?? ""),
        String(record.inputTokens ?? ""),
        String(record.outputTokens ?? ""),
        String(record.cachedTokens ?? ""),
        String(record.reasoningTokens ?? ""),
        String(record.cost ?? ""),
        String(record.currency ?? ""),
        String(record.source ?? ""),
        String(record.externalId ?? ""),
      ]);
    }
  }

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
