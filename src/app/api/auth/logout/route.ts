import type { NextRequest } from "next/server";
import { assertSameOrigin, destroySession, getSessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { withApi, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await getSessionUser();
    await destroySession();

    if (user) {
      await recordAudit({ userId: user.id, eventType: "USER_LOGGED_OUT" });
    }

    return json({ ok: true });
  });
}
