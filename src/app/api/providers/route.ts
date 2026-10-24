import type { NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { createAccount } from "@/lib/accounts";
import { providerCreateSchema } from "@/lib/schemas";
import { json, readJson, withApi } from "@/lib/http";
import { getAccountDetail, listAccounts } from "@/lib/dashboard";
import { requestRefresh } from "@/lib/refresh";
import { rateLimit } from "@/lib/rate-limit";
import { AppError, sanitizeMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const accounts = await listAccounts(user.id);
    return json({ accounts });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();

    const limit = rateLimit(`provider-create:${user.id}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many connections created. Try again later.");
    }

    const input = await readJson(request, providerCreateSchema);
    const account = await createAccount({
      userId: user.id,
      provider: input.provider,
      displayName: input.displayName,
      authMode: input.authMode ?? "MANUAL",
      credential: input.credential,
      planName: input.planName,
      accountLabel: input.accountLabel,
      refreshIntervalMin: input.refreshIntervalMin ?? user.refreshIntervalMin,
    });

    let refreshOutcome: string | null = null;
    if (input.authMode === "LIVE") {
      try {
        const refresh = await requestRefresh(user.id, account.id);
        refreshOutcome = refresh.outcome?.status ?? "queued";
      } catch (error) {
        // Creation succeeds even if the first probe fails; the detail page shows
        // the sanitized diagnostic and lets the user replace the credential.
        console.warn("[providers] initial refresh failed:", sanitizeMessage(error));
        refreshOutcome = "failed";
      }
    }

    const detail = await getAccountDetail(user.id, account.id);
    return json({ account: detail, refreshOutcome }, 201);
  });
}
