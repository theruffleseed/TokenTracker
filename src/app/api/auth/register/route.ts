import type { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { json, readJson, withApi } from "@/lib/http";
import { registerSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const env = getEnv();

    if (!env.ALLOW_REGISTRATION) {
      throw new AppError("REGISTRATION_DISABLED", "Registration is closed");
    }

    const limit = rateLimit(`register:${clientIp(request)}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many sign-up attempts. Try again later.");
    }

    const input = await readJson(request, registerSchema);
    const passwordHash = await hashPassword(input.password);

    try {
      const user = await prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName || null,
          refreshIntervalMin: env.REFRESH_DEFAULT_INTERVAL_MINUTES,
        },
        select: { id: true, email: true, displayName: true, timezone: true },
      });

      await createSession(user.id, request.headers.get("user-agent"));
      await recordAudit({
        userId: user.id,
        eventType: "USER_REGISTERED",
        metadata: { method: "password" },
      });

      return json({ user }, 201);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new AppError("CONFLICT", "An account with this email already exists");
      }
      throw error;
    }
  });
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
