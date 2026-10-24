import type { NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { requestRefresh } from "@/lib/refresh";
import { json, withApi } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { AdapterError } from "@/lib/providers/types";
import { AppError } from "@/lib/errors";
import { getAccountDetail } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Context): Promise<Response> {
  return withApi(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;

    const limit = rateLimit(`refresh:${user.id}:${id}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many refreshes. Try again in a few minutes.");
    }

    try {
      const result = await requestRefresh(user.id, id);
      const account = await getAccountDetail(user.id, id);
      return json({
        outcome: result.outcome,
        queued: result.queued,
        jobId: result.jobId,
        account,
      });
    } catch (error) {
      if (error instanceof AdapterError) {
        if (error.code === "UNSUPPORTED") {
          throw new AppError("BAD_REQUEST", error.message);
        }
        throw new AppError("BAD_REQUEST", error.message);
      }
      throw error;
    }
  });
}
