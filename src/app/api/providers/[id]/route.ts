import type { NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { disconnectAccount, updateAccount } from "@/lib/accounts";
import { providerUpdateSchema } from "@/lib/schemas";
import { json, readJson, withApi } from "@/lib/http";
import { getAccountDetail } from "@/lib/dashboard";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Context): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    const account = await getAccountDetail(user.id, id);
    if (!account) throw new AppError("NOT_FOUND", "Provider connection not found");
    return json({ account });
  });
}

export async function PATCH(request: NextRequest, { params }: Context): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    const input = await readJson(request, providerUpdateSchema);
    await updateAccount(user.id, id, input);
    const account = await getAccountDetail(user.id, id);
    return json({ account });
  });
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    await disconnectAccount(user.id, id);
    return json({ ok: true });
  });
}
