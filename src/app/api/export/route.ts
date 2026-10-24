import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildExport, buildUsageCsv } from "@/lib/export";
import { withApi } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const format = new URL(request.url).searchParams.get("format") ?? "json";
    const bundle = await buildExport(user.id);

    if (format === "csv") {
      const csv = buildUsageCsv(bundle);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="tokentracker-usage-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format !== "json") {
      return new Response(
        JSON.stringify({ error: { code: "BAD_REQUEST", message: "Unknown export format" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ data: bundle }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="tokentracker-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
