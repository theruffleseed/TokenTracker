import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "./env";
import { AppError } from "./errors";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

function loadKey(version: number): Buffer {
  const env = getEnv();
  if (version !== env.CREDENTIAL_ENCRYPTION_KEY_VERSION) {
    // Key rotation is intentionally explicit: old ciphertext must be re-encrypted
    // by an operator-held previous key before the version is retired.
    throw new AppError(
      "INTERNAL_ERROR",
      `Credential key version ${version} is not available`,
    );
  }
  return Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "base64");
}

/**
 * AES-256-GCM with a fresh 96-bit IV per secret. The key version travels with
 * the envelope so future rotations can be handled without guessing.
 */
export function encryptSecret(plaintext: string): EncryptedSecret {
  if (!plaintext.trim()) {
    throw new AppError("BAD_REQUEST", "Credential must not be empty");
  }

  const env = getEnv();
  const key = loadKey(env.CREDENTIAL_ENCRYPTION_KEY_VERSION);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: env.CREDENTIAL_ENCRYPTION_KEY_VERSION,
  };
}

export function decryptSecret(envelope: EncryptedSecret): string {
  const key = loadKey(envelope.keyVersion);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");

  if (iv.length !== 12 || tag.length !== 16) {
    throw new AppError("INTERNAL_ERROR", "Credential envelope is malformed");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new AppError(
      "INTERNAL_ERROR",
      "Credential could not be decrypted; the encryption key may have changed",
    );
  }
}

/** Non-secret display hint, e.g. "…a1b2". */
export function credentialHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return "••••";
  return `…${trimmed.slice(-4)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
