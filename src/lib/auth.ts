import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "./db";
import { AppError } from "./errors";
import { createSessionToken, hashSessionToken } from "./tokens";
import { getEnv } from "./env";

export const SESSION_COOKIE = "tt_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  refreshIntervalMin: number;
  quotaRetentionDays: number;
  usageRetentionDays: number;
  auditRetentionDays: number;
  gatewayTokenHint: string | null;
  gatewayTokenCreatedAt: Date | null;
  createdAt: Date;
}

function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.SESSION_COOKIE_SECURE,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export async function createSession(
  userId: string,
  userAgent?: string | null,
): Promise<void> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }

  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          timezone: true,
          refreshIntervalMin: true,
          quotaRetentionDays: true,
          usageRetentionDays: true,
          auditRetentionDays: true,
          gatewayTokenHint: true,
          gatewayTokenCreatedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});
  }

  return session.user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new AppError("UNAUTHORIZED", "Sign in to continue");
  }
  return user;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

/**
 * Defense-in-depth CSRF check for cookie-authenticated mutations. Browser
 * requests must be same-origin; non-browser clients without Origin still need
 * a valid session cookie.
 */
export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const host = request.headers.get("host");
  const env = getEnv();

  if (fetchSite === "cross-site") {
    throw new AppError("FORBIDDEN", "Cross-site request rejected");
  }

  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("FORBIDDEN", "Invalid request origin");
    }
    const allowed = new Set(
      [host, new URL(env.APP_URL).host].filter((value): value is string => !!value),
    );
    if (!allowed.has(originHost)) {
      throw new AppError("FORBIDDEN", "Request origin is not allowed");
    }
  }
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}
