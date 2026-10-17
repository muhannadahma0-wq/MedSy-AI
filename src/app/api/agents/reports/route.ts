/** POST /api/agents/reports — list the CALLER's stored reports (Phase 12). */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { serializeReport } from "@/lib/server/serialize";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  try {
    const reports = await db.report.findMany({ where: { userId: guard.id } });
    return json({ reports: reports.map(serializeReport) });
  } catch (error) {
    console.error("[agents/reports] failed:", error);
    return json({ message: "Failed to fetch reports" }, 500);
  }
}

export const POST = withMetrics("POST /api/agents/reports", handler_POST);
