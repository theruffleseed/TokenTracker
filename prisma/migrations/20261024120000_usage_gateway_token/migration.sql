-- One usage-gateway bearer token per user. Only a SHA-256 digest is stored;
-- a database read cannot be replayed against the gateway.
ALTER TABLE "User" ADD COLUMN "gatewayTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "gatewayTokenHint" VARCHAR(32);
ALTER TABLE "User" ADD COLUMN "gatewayTokenCreatedAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "User_gatewayTokenHash_key"
  ON "User" ("gatewayTokenHash");

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'GATEWAY_TOKEN_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'GATEWAY_TOKEN_REVOKED';
