import type { NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/settings";
import { settingsSchema } from "@/lib/schemas";
import { json, readJson, withApi } from "@/lib/http";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const settings = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        email: true,
        displayName: true,
        timezone: true,
        refreshIntervalMin: true,
        quotaRetentionDays: true,
        usageRetentionDays: true,
        auditRetentionDays: true,
        createdAt: true,
      },
    });
    return json({ settings });
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = await readJson(request, settingsSchema);
    await updateSettings(user.id, input);
    return json({ ok: true });
  });
}
