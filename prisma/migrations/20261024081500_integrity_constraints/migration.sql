-- Single-flight guard: at most one active refresh job per provider account.
-- Prisma cannot express partial unique indexes in the schema, so it lives here.
CREATE UNIQUE INDEX "RefreshJob_active_providerAccountId_key"
  ON "RefreshJob" ("providerAccountId")
  WHERE "status" IN ('PENDING', 'RUNNING');

-- Percentages are stored as 0-100, never as 0-1 fractions.
ALTER TABLE "QuotaSnapshot"
  ADD CONSTRAINT "QuotaSnapshot_remainingPercent_range"
  CHECK ("remainingPercent" IS NULL OR ("remainingPercent" >= 0 AND "remainingPercent" <= 100));

-- Metered values are non-negative.
ALTER TABLE "QuotaSnapshot"
  ADD CONSTRAINT "QuotaSnapshot_values_nonnegative"
  CHECK (
    ("limitValue" IS NULL OR "limitValue" >= 0) AND
    ("usedValue" IS NULL OR "usedValue" >= 0) AND
    ("remainingValue" IS NULL OR "remainingValue" >= 0)
  );

ALTER TABLE "CreditSnapshot"
  ADD CONSTRAINT "CreditSnapshot_amount_nonnegative"
  CHECK ("amount" >= 0);

ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_tokens_nonnegative"
  CHECK (
    ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
    ("outputTokens" IS NULL OR "outputTokens" >= 0) AND
    ("cachedTokens" IS NULL OR "cachedTokens" >= 0) AND
    ("reasoningTokens" IS NULL OR "reasoningTokens" >= 0)
  );

ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_cost_nonnegative"
  CHECK ("cost" IS NULL OR "cost" >= 0);
