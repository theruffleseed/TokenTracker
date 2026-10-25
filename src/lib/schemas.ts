import { z } from "zod";

export const PROVIDERS = [
  "OPENCODE_GO",
  "TOKENHARBOR",
  "RIVER_AI",
  "COMMANDCODE",
  "QODER",
  "YETA",
] as const;
export type ProviderKey = (typeof PROVIDERS)[number];

export const QUOTA_WINDOWS = [
  "rolling_5h",
  "daily",
  "weekly",
  "monthly",
  "other",
] as const;
export type QuotaWindowKey = (typeof QUOTA_WINDOWS)[number];

export const QUOTA_UNITS = [
  "tokens",
  "requests",
  "credits",
  "usd",
  "percent",
  "provider_defined",
] as const;
export type QuotaUnitKey = (typeof QUOTA_UNITS)[number];

export const CREDIT_TYPES = [
  "WALLET",
  "PROMOTIONAL",
  "REWARD",
  "INCLUDED_ALLOWANCE",
  "OTHER",
] as const;

export const AUTH_MODES = ["LIVE", "MANUAL"] as const;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(200, "Password is too long"),
  displayName: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const providerCreateSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    displayName: z.string().trim().min(1, "Give this connection a name").max(80),
    authMode: z.enum(AUTH_MODES).default("MANUAL"),
    credential: z.string().trim().max(4000).optional(),
    planName: z.string().trim().max(80).optional(),
    accountLabel: z.string().trim().max(160).optional(),
    refreshIntervalMin: z.coerce.number().int().min(5).max(1440).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.authMode === "LIVE" && value.provider !== "QODER" && !value.credential) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["credential"],
        message: "An API key is required for live connections",
      });
    }
  });

export const providerUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  planName: z.string().trim().max(80).nullable().optional(),
  accountLabel: z.string().trim().max(160).nullable().optional(),
  refreshIntervalMin: z.coerce.number().int().min(5).max(1440).optional(),
  isActive: z.boolean().optional(),
});

export const credentialUpdateSchema = z.object({
  credential: z.string().trim().min(1, "Enter an API key").max(4000),
});

const optionalMetric = z.number().finite().min(0).nullable().optional();

export const manualQuotaSchema = z
  .object({
    windowType: z.enum(QUOTA_WINDOWS),
    unit: z.enum(QUOTA_UNITS),
    limitValue: optionalMetric,
    usedValue: optionalMetric,
    remainingValue: optionalMetric,
    remainingPercent: z.number().finite().min(0).max(100).nullable().optional(),
    resetsAt: z.string().datetime({ offset: true }).nullable().optional(),
    modelScope: z.string().trim().max(160).nullable().optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, ctx) => {
    const hasPercent = value.remainingPercent !== undefined && value.remainingPercent !== null;
    const hasLimit = value.limitValue !== undefined && value.limitValue !== null;
    const hasUsed = value.usedValue !== undefined && value.usedValue !== null;
    const hasRemaining = value.remainingValue !== undefined && value.remainingValue !== null;

    if (!hasPercent && !(hasLimit && (hasUsed || hasRemaining)) && !(hasUsed && hasRemaining)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingPercent"],
        message: "Provide a percentage, or a limit with used/remaining, or used and remaining",
      });
    }

    if (hasLimit && hasUsed && value.usedValue! > value.limitValue!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usedValue"],
        message: "Used cannot exceed the limit",
      });
    }

    if (hasLimit && hasUsed && hasRemaining) {
      const gap = Math.abs(value.limitValue! - value.usedValue! - value.remainingValue!);
      const tolerance = Math.max(0.01, value.limitValue! * 0.0001);
      if (gap > tolerance) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["remainingValue"],
          message: "Limit, used, and remaining do not add up",
        });
      }
    }

    if (value.unit === "percent" && !hasPercent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingPercent"],
        message: "Percent quotas require a remaining percentage",
      });
    }
  });

export const manualCreditSchema = z.object({
  amount: z.number().finite().min(0).max(1_000_000_000),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  creditType: z.enum(CREDIT_TYPES),
  observedAt: z.string().datetime({ offset: true }).optional(),
});

export const settingsSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA timezone")
    .optional(),
  refreshIntervalMin: z.coerce.number().int().min(5).max(1440).optional(),
  quotaRetentionDays: z.coerce.number().int().min(7).max(3650).optional(),
  usageRetentionDays: z.coerce.number().int().min(7).max(3650).optional(),
  auditRetentionDays: z.coerce.number().int().min(7).max(3650).optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
  revokeOtherSessions: z.boolean().default(true),
});
