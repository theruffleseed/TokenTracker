import type { NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { json, withApi } from "@/lib/http";
import { createGatewayToken } from "@/lib/gateway/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue or rotate the user's single gateway token. Plaintext is returned once. */
export async function POST(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const issued = createGatewayToken();
    const createdAt = new Date();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        gatewayTokenHash: issued.tokenHash,
        gatewayTokenHint: issued.hint,
        gatewayTokenCreatedAt: createdAt,
      },
    });

    await recordAudit({
      userId: user.id,
      eventType: "GATEWAY_TOKEN_CREATED",
      metadata: { hint: issued.hint },
    });

    return json({
      token: issued.token,
      hint: issued.hint,
      createdAt: createdAt.toISOString(),
    });
  });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        gatewayTokenHash: null,
        gatewayTokenHint: null,
        gatewayTokenCreatedAt: null,
      },
    });

    await recordAudit({
      userId: user.id,
      eventType: "GATEWAY_TOKEN_REVOKED",
      metadata: {},
    });

    return json({ ok: true });
  });
}
