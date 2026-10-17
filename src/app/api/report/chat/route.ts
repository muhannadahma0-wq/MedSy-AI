/** POST /api/report/chat — port of reportAnalysis.js (pdfQ).
 *  Phase 12: ownership check — Q&A is restricted to the report's owner. */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { pdfQ } from "@/lib/server/report-analysis";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const { question, reportId } = await readJson<{ question?: string; reportId?: string }>(req);

  if (reportId) {
    const report = await db.report.findUnique({ where: { id: reportId }, select: { userId: true } });
    if (!report || report.userId !== guard.id) {
      return json({ success: false, message: "Report not found" }, 404);
    }
  }

  const result = await pdfQ({ question: question || "", reportId: reportId || "" });
  return json(result.body, result.status);
}

export const POST = withMetrics("POST /api/report/chat", handler_POST);
