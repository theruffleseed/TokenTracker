import type { NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { replaceCredential } from "@/lib/accounts";
import { credentialUpdateSchema } from "@/lib/schemas";
import { json, readJson, withApi } from "@/lib/http";
import { getAccountDetail } from "@/lib/dashboard";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Context): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;

    const limit = rateLimit(`credential:${user.id}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many credential updates. Try again later.");
    }

    const input = await readJson(request, credentialUpdateSchema);
    await replaceCredential(user.id, id, input.credential);
    const account = await getAccountDetail(user.id, id);
    return json({ account });
  });
}
