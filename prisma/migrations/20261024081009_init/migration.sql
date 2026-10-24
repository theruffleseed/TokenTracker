-- CreateEnum
CREATE TYPE "public"."Provider" AS ENUM ('OPENCODE_GO', 'TOKENHARBOR', 'RIVER_AI', 'COMMANDCODE');

-- CreateEnum
CREATE TYPE "public"."AuthMode" AS ENUM ('LIVE', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."ConnectionStatus" AS ENUM ('NEVER_CONNECTED', 'CONNECTED', 'NEEDS_ATTENTION', 'ERROR', 'MANUAL', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "public"."DataSource" AS ENUM ('LIVE', 'MANUAL', 'CACHED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "public"."QuotaWindowType" AS ENUM ('ROLLING_5H', 'DAILY', 'WEEKLY', 'MONTHLY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."QuotaUnit" AS ENUM ('TOKENS', 'REQUESTS', 'CREDITS', 'USD', 'PERCENT', 'PROVIDER_DEFINED');

-- CreateEnum
CREATE TYPE "public"."CreditType" AS ENUM ('WALLET', 'PROMOTIONAL', 'REWARD', 'INCLUDED_ALLOWANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RefreshStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."RefreshTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "public"."AuditEventType" AS ENUM ('USER_REGISTERED', 'USER_LOGGED_IN', 'USER_LOGGED_OUT', 'SESSIONS_REVOKED', 'PROVIDER_CONNECTED', 'PROVIDER_UPDATED', 'PROVIDER_DISCONNECTED', 'CREDENTIAL_UPDATED', 'MANUAL_SNAPSHOT_ADDED', 'REFRESH_QUEUED', 'REFRESH_COMPLETED', 'REFRESH_FAILED', 'SETTINGS_UPDATED', 'DATA_EXPORTED', 'RETENTION_PURGED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "refreshIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "quotaRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "usageRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" VARCHAR(256),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "authMode" "public"."AuthMode" NOT NULL DEFAULT 'MANUAL',
    "displayName" VARCHAR(80) NOT NULL,
    "planName" VARCHAR(80),
    "accountLabel" VARCHAR(160),
    "status" "public"."ConnectionStatus" NOT NULL DEFAULT 'NEVER_CONNECTED',
    "credentialCiphertext" TEXT,
    "credentialIv" TEXT,
    "credentialTag" TEXT,
    "credentialKeyVersion" INTEGER,
    "credentialHint" VARCHAR(32),
    "refreshIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "lastSyncedAt" TIMESTAMPTZ(6),
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" VARCHAR(500),
    "nextRefreshAt" TIMESTAMPTZ(6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuotaSnapshot" (
    "id" UUID NOT NULL,
    "providerAccountId" UUID NOT NULL,
    "windowType" "public"."QuotaWindowType" NOT NULL,
    "unit" "public"."QuotaUnit" NOT NULL,
    "limitValue" DECIMAL(30,10),
    "usedValue" DECIMAL(30,10),
    "remainingValue" DECIMAL(30,10),
    "remainingPercent" DECIMAL(10,4),
    "resetsAt" TIMESTAMPTZ(6),
    "modelScope" VARCHAR(160),
    "source" "public"."DataSource" NOT NULL,
    "observedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditSnapshot" (
    "id" UUID NOT NULL,
    "providerAccountId" UUID NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "creditType" "public"."CreditType" NOT NULL,
    "source" "public"."DataSource" NOT NULL,
    "observedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageRecord" (
    "id" UUID NOT NULL,
    "providerAccountId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "modelId" VARCHAR(160),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "cost" DECIMAL(30,10),
    "currency" VARCHAR(3),
    "source" "public"."DataSource" NOT NULL,
    "externalId" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RefreshJob" (
    "id" UUID NOT NULL,
    "providerAccountId" UUID NOT NULL,
    "status" "public"."RefreshStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "public"."RefreshTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ(6),
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RefreshJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventType" "public"."AuditEventType" NOT NULL,
    "providerAccountId" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt");

-- CreateIndex
CREATE INDEX "ProviderAccount_userId_status_idx" ON "public"."ProviderAccount"("userId", "status");

-- CreateIndex
CREATE INDEX "ProviderAccount_nextRefreshAt_idx" ON "public"."ProviderAccount"("nextRefreshAt");

-- CreateIndex
CREATE INDEX "ProviderAccount_isActive_nextRefreshAt_idx" ON "public"."ProviderAccount"("isActive", "nextRefreshAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_userId_provider_displayName_key" ON "public"."ProviderAccount"("userId", "provider", "displayName");

-- CreateIndex
CREATE INDEX "QuotaSnapshot_providerAccountId_observedAt_idx" ON "public"."QuotaSnapshot"("providerAccountId", "observedAt");

-- CreateIndex
CREATE INDEX "QuotaSnapshot_providerAccountId_windowType_modelScope_obser_idx" ON "public"."QuotaSnapshot"("providerAccountId", "windowType", "modelScope", "observedAt");

-- CreateIndex
CREATE INDEX "QuotaSnapshot_observedAt_idx" ON "public"."QuotaSnapshot"("observedAt");

-- CreateIndex
CREATE INDEX "CreditSnapshot_providerAccountId_observedAt_idx" ON "public"."CreditSnapshot"("providerAccountId", "observedAt");

-- CreateIndex
CREATE INDEX "CreditSnapshot_observedAt_idx" ON "public"."CreditSnapshot"("observedAt");

-- CreateIndex
CREATE INDEX "UsageRecord_providerAccountId_occurredAt_idx" ON "public"."UsageRecord"("providerAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageRecord_occurredAt_idx" ON "public"."UsageRecord"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_providerAccountId_externalId_key" ON "public"."UsageRecord"("providerAccountId", "externalId");

-- CreateIndex
CREATE INDEX "RefreshJob_status_scheduledAt_idx" ON "public"."RefreshJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "RefreshJob_providerAccountId_status_idx" ON "public"."RefreshJob"("providerAccountId", "status");

-- CreateIndex
CREATE INDEX "RefreshJob_finishedAt_idx" ON "public"."RefreshJob"("finishedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "public"."AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_providerAccountId_createdAt_idx" ON "public"."AuditEvent"("providerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "public"."AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderAccount" ADD CONSTRAINT "ProviderAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuotaSnapshot" ADD CONSTRAINT "QuotaSnapshot_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "public"."ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditSnapshot" ADD CONSTRAINT "CreditSnapshot_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "public"."ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsageRecord" ADD CONSTRAINT "UsageRecord_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "public"."ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RefreshJob" ADD CONSTRAINT "RefreshJob_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "public"."ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "public"."ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
