import { randomBytes } from "node:crypto";
import { hashString } from "../tokens";

export const GATEWAY_TOKEN_PREFIX = "ttg_";

export interface GatewayToken {
  /** Plaintext token. Returned to the browser exactly once. */
  token: string;
  /** Masked value safe to display later. */
  hint: string;
  tokenHash: string;
}

/**
 * 256 bits of randomness. The gateway token is independent of the session
 * cookie and of any provider key, so it can be revoked without signing out.
 */
export function createGatewayToken(): GatewayToken {
  const token = `${GATEWAY_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const hint = `${token.slice(0, 10)}…${token.slice(-4)}`;
  return { token, hint, tokenHash: hashString(token) };
}

export function hashGatewayToken(token: string): string {
  return hashString(token);
}

export function looksLikeGatewayToken(token: string): boolean {
  return token.startsWith(GATEWAY_TOKEN_PREFIX) && token.length >= 32;
}

/** Extract a bearer token or Anthropic-style `x-api-key` value. */
export function gatewayTokenFromHeaders(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }
  return headers.get("x-api-key")?.trim() || null;
}
