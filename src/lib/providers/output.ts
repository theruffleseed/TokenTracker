import { z } from "zod";
import { QUOTA_UNITS, QUOTA_WINDOWS, CREDIT_TYPES } from "../schemas";

const nullableNumber = z.number().finite().nullable();
const nullableIso = z
  .string()
  .datetime({ offset: true })
  .nullable();

export const quotaSnapshotInputSchema = z
  .object({
    window: z.enum(QUOTA_WINDOWS),
    unit: z.enum(QUOTA_UNITS),
    limit: nullableNumber,
    used: nullableNumber,
    remaining: nullableNumber,
    remainingPercent: z.number().finite().min(0).max(100).nullable(),
    resetsAt: nullableIso,
    observedAt: z.string().datetime({ offset: true }),
    modelScope: z.string().max(160).nullable(),
    source: z.enum(["live", "manual", "cached", "estimated"]),
  })
  .strict();

export const creditSnapshotInputSchema = z
  .object({
    amount: z.number().finite().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    creditType: z.enum(CREDIT_TYPES),
    observedAt: z.string().datetime({ offset: true }),
    source: z.enum(["live", "manual", "cached", "estimated"]),
  })
  .strict();

export const usageRecordInputSchema = z
  .object({
    occurredAt: z.string().datetime({ offset: true }),
    modelId: z.string().max(160).nullable(),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    cachedTokens: z.number().int().min(0).nullable(),
    reasoningTokens: z.number().int().min(0).nullable(),
    cost: z.number().finite().min(0).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    source: z.enum(["live", "manual", "cached", "estimated"]),
    externalId: z.string().max(200).nullable(),
  })
  .strict();

export const quotaSnapshotListSchema = z.array(quotaSnapshotInputSchema).max(500);
export const creditSnapshotListSchema = z.array(creditSnapshotInputSchema).max(200);
export const usageRecordListSchema = z.array(usageRecordInputSchema).max(10_000);
