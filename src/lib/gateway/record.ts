import { randomUUID } from "node:crypto";
import type { CreditSnapshot, Prisma, ProviderAccount, QuotaSnapshot } from "@prisma/client";
import { prisma } from "../db";
import { weeklyAllowanceForPlan } from "./config";
import { estimateCost, findPrice, getPricing, type ModelPrice } from "./pricing";
import type { CapturedUsage } from "./usage";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Prefer Pass value, then cash-like balances, when attributing estimated spend. */
const SPEND_PRIORITY = [
  "INCLUDED_ALLOWANCE",
  "WALLET",
  "PROMOTIONAL",
  "REWARD",
  "OTHER",
] as const;

type GatewayAccount = Pick<ProviderAccount, "id" | "provider" | "planName">;

export interface GatewayUsageRecord {
  id: string;
  cost: number | null;
  priced: boolean;
}

/**
 * Persist one gateway request as an estimated usage record, then re-derive the
 * estimated balance and TokenHarbor paid-model weekly window from the latest
 * real (live or manual) anchor. Re-deriving makes repeated calls idempotent and
 * lets a fresh manual snapshot reset the baseline without double charging.
 */
export async function recordGatewayUsage(
  account: GatewayAccount,
  usage: CapturedUsage,
  options: { now?: Date; price?: ModelPrice | null } = {},
): Promise<GatewayUsageRecord | null> {
  if (
    usage.inputTokens === null &&
    usage.cachedTokens === null &&
    usage.cacheWriteTokens === null &&
    usage.outputTokens === null
  ) {
    return null;
  }

  const now = options.now ?? new Date();
  const price =
    "price" in options
      ? options.price ?? null
      : findPrice(await getPricing(account.provider), usage.modelId);
  const cost = estimateCost(price, usage);
  const recordId = randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.usageRecord.create({
      data: {
        providerAccountId: account.id,
        occurredAt: now,
        modelId: usage.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        reasoningTokens: usage.reasoningTokens,
        cost,
        currency: cost === null ? null : "USD",
        source: "ESTIMATED",
        externalId: `gw_${recordId}`,
      },
    });

    if (cost && cost > 0) {
      await applyCreditEstimate(tx, account, cost, now);
      if (account.provider === "TOKENHARBOR") {
        await applyWeeklyPassEstimate(tx, account, cost, now);
      }
    }
  });

  return { id: recordId, cost, priced: price !== null };
}

type Tx = Prisma.TransactionClient;

function decimalToNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : null;
}

async function latestAnchors(
  tx: Tx,
  accountId: string,
): Promise<Map<CreditSnapshot["creditType"], CreditSnapshot>> {
  const rows = await tx.creditSnapshot.findMany({
    where: {
      providerAccountId: accountId,
      currency: "USD",
      source: { in: ["LIVE", "MANUAL"] },
    },
    orderBy: { observedAt: "desc" },
    take: 40,
  });

  const latest = new Map<CreditSnapshot["creditType"], CreditSnapshot>();
  for (const row of rows) {
    if (!latest.has(row.creditType)) latest.set(row.creditType, row);
  }
  return latest;
}

async function spendSince(tx: Tx, accountId: string, since: Date): Promise<number> {
  const aggregate = await tx.usageRecord.aggregate({
    where: {
      providerAccountId: accountId,
      source: "ESTIMATED",
      cost: { not: null },
      occurredAt: { gt: since },
    },
    _sum: { cost: true },
  });
  return decimalToNumber(aggregate._sum.cost) ?? 0;
}

async function applyCreditEstimate(
  tx: Tx,
  account: GatewayAccount,
  cost: number,
  now: Date,
): Promise<void> {
  const anchors = await latestAnchors(tx, account.id);

  // A TokenHarbor Pass is a separate allowance from the wallet. When Pass
  // usage is being tracked, do not also drain the wallet for the same tokens.
  if (account.provider === "TOKENHARBOR") {
    const included = anchors.get("INCLUDED_ALLOWANCE");
    if (!included) {
      const passQuota = await tx.quotaSnapshot.findFirst({
        where: {
          providerAccountId: account.id,
          windowType: "WEEKLY",
          modelScope: { contains: "paid", mode: "insensitive" },
          source: { in: ["LIVE", "MANUAL"] },
        },
        select: { id: true },
      });
      if (passQuota) return;
    }
  }

  let base: CreditSnapshot | null = null;
  for (const type of SPEND_PRIORITY) {
    const candidate = anchors.get(type);
    if (candidate) {
      base = candidate;
      break;
    }
  }
  if (!base) return;

  const baseAmount = decimalToNumber(base.amount) ?? 0;
  const spent = await spendSince(tx, account.id, base.observedAt);
  const amount = Math.max(0, baseAmount - spent);

  const existing = await tx.creditSnapshot.findFirst({
    where: {
      providerAccountId: account.id,
      creditType: base.creditType,
      currency: base.currency,
      source: "ESTIMATED",
    },
    orderBy: { observedAt: "desc" },
  });

  if (existing) {
    await tx.creditSnapshot.update({
      where: { id: existing.id },
      data: { amount, observedAt: now },
    });
  } else {
    await tx.creditSnapshot.create({
      data: {
        providerAccountId: account.id,
        amount,
        currency: base.currency,
        creditType: base.creditType,
        source: "ESTIMATED",
        observedAt: now,
      },
    });
  }
}

/**
 * TokenHarbor's paid-model Pass window is denominated in included usage value.
 * When the Pass tier is known, public list prices let us convert gateway spend
 * into the same weekly USD window. Without a tier (or a prior manual limit)
 * there is no honest percentage to show, so no quota row is written.
 */
async function applyWeeklyPassEstimate(
  tx: Tx,
  account: GatewayAccount,
  cost: number,
  now: Date,
): Promise<void> {
  const base = await tx.quotaSnapshot.findFirst({
    where: {
      providerAccountId: account.id,
      windowType: "WEEKLY",
      modelScope: { contains: "paid", mode: "insensitive" },
      source: { in: ["LIVE", "MANUAL"] },
    },
    orderBy: { observedAt: "desc" },
  });

  const baseLimit = base ? decimalToNumber(base.limitValue) : null;
  const allowance = baseLimit ?? weeklyAllowanceForPlan(account.planName);
  if (!allowance || allowance <= 0) return;

  const baseUsed = base ? usedFromAnchor(base, allowance) : 0;
  const anchor = base?.observedAt ?? new Date(now.getTime() - 7 * DAY_MS);
  const spent = await spendSince(tx, account.id, anchor);
  const used = baseUsed + spent;
  const remaining = Math.max(0, allowance - used);
  const remainingPercent = Math.max(0, Math.min(100, (remaining / allowance) * 100));

  const data = {
    limitValue: allowance,
    usedValue: used,
    remainingValue: remaining,
    remainingPercent,
    resetsAt: base?.resetsAt ?? null,
    observedAt: now,
    source: "ESTIMATED" as const,
  };

  const existing = await tx.quotaSnapshot.findFirst({
    where: {
      providerAccountId: account.id,
      windowType: "WEEKLY",
      unit: "USD",
      modelScope: "Paid models",
      source: "ESTIMATED",
    },
    orderBy: { observedAt: "desc" },
  });

  if (existing) {
    await tx.quotaSnapshot.update({ where: { id: existing.id }, data });
  } else {
    await tx.quotaSnapshot.create({
      data: {
        providerAccountId: account.id,
        windowType: "WEEKLY",
        unit: "USD",
        modelScope: "Paid models",
        ...data,
      },
    });
  }
}

function usedFromAnchor(base: QuotaSnapshot, allowance: number): number {
  const used = decimalToNumber(base.usedValue);
  if (used !== null) return used;

  const limit = decimalToNumber(base.limitValue) ?? allowance;
  const remaining = decimalToNumber(base.remainingValue);
  if (remaining !== null) return Math.max(0, limit - remaining);

  const percent = decimalToNumber(base.remainingPercent);
  if (percent !== null) return Math.max(0, ((100 - percent) / 100) * allowance);

  return 0;
}

/**
 * Serialize persistence so two concurrent gateway requests cannot both derive
 * snapshots from a stale baseline.
 */
let queue: Promise<void> = Promise.resolve();

export function enqueueGatewayUsage(
  account: GatewayAccount,
  usage: CapturedUsage,
): void {
  queue = queue
    .then(async () => {
      await recordGatewayUsage(account, usage);
    })
    .catch((error) => {
      console.warn(
        `[gateway] could not persist usage: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
}

/** Test helper: wait for all queued persistence to finish. */
export async function flushGatewayUsage(): Promise<void> {
  await queue;
}
