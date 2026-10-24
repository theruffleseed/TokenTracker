import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/**
 * scrypt is used instead of a native argon2 dependency so the app deploys to
 * any Node host without compiling binaries. Parameters target ~16 MiB and are
 * encoded in the hash for future upgrades.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters");
  }

  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...SCRYPT_PARAMS,
  });

  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  const salt = Buffer.from(saltRaw ?? "", "base64");
  const expected = Buffer.from(hashRaw ?? "", "base64");

  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    salt.length === 0 ||
    expected.length !== KEY_LENGTH
  ) {
    return false;
  }

  try {
    const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
