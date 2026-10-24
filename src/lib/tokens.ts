import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "./env";

/**
 * Session bearer tokens are 256-bit random values. Only a SHA-256 digest is
 * persisted, so a database read cannot be replayed as a session.
 */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newUuid(): string {
  return crypto.randomUUID();
}

/** Stable key id for credential envelope versioning. */
export function currentCredentialKeyVersion(): number {
  return getEnv().CREDENTIAL_ENCRYPTION_KEY_VERSION;
}
