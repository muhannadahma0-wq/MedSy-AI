/** GET /api/report/[id]/readability — port of getReportReadability.
 *  Phase 12: ownership check — a report may only be read by its owner. */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { getReportReadability } from "@/lib/server/report-analysis";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const { id } = await params;
  const report = await db.report.findUnique({ where: { id }, select: { userId: true } });
  if (!report || report.userId !== guard.id) {
    return json({ success: false, message: "Report not found" }, 404);
  }

  const result = await getReportReadability(id);
  return json(result.body, result.status);
}
