import { getSessionUser } from "@/lib/auth";
import { json, withApi } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await getSessionUser();
    return json({ user });
  });
}
