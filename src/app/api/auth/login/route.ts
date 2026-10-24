import type { NextRequest } from "next/server";
import { assertSameOrigin, createSession } from "@/lib/auth";
import { verifyPassword, hashPassword } from "@/lib/password";
import { json, readJson, withApi } from "@/lib/http";
import { loginSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("token-tracker-dummy-password");
  return dummyHashPromise;
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const input = await readJson(request, loginSchema);
    const ip = clientIp(request);
    const ipLimit = rateLimit(`login-ip:${ip}`, 50, 15 * 60 * 1000);
    const accountLimit = rateLimit(`login:${ip}:${input.email}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Try again later.");
    }

    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        displayName: true,
        timezone: true,
        passwordHash: true,
      },
    });

    if (!user) {
      await verifyPassword(input.password, await getDummyHash());
      throw new AppError("UNAUTHORIZED", "Email or password is incorrect");
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError("UNAUTHORIZED", "Email or password is incorrect");
    }

    await createSession(user.id, request.headers.get("user-agent"));
    await recordAudit({
      userId: user.id,
      eventType: "USER_LOGGED_IN",
      metadata: { method: "password" },
    });

    return json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        timezone: user.timezone,
      },
    });
  });
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}
