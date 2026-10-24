import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({
      status: "ok",
      database: "reachable",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json(
      { status: "degraded", database: "unreachable", timestamp: new Date().toISOString() },
      503,
    );
  }
}
