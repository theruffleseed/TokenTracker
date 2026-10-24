import type { NextRequest } from "next/server";
import { assertSameOrigin, createSession, requireUser, revokeAllSessions } from "@/lib/auth";
import { changePassword } from "@/lib/settings";
import { passwordChangeSchema } from "@/lib/schemas";
import { json, readJson, withApi } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();

    const limit = rateLimit(`password:${user.id}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many password attempts. Try again later.");
    }

    const input = await readJson(request, passwordChangeSchema);
    await changePassword(user.id, input.currentPassword, input.newPassword);

    if (input.revokeOtherSessions) {
      await revokeAllSessions(user.id);
      await createSession(user.id, request.headers.get("user-agent"));
    }

    return json({ ok: true });
  });
}
