/**
 * POST /api/medicine/check-interactions — port of addMedicineController.js
 * (checkInteractions). Protected by auth; user derived from the JWT.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
// MR-1 central fix (2026-10-01): getAuthUser → requireSelf (state + tokenVersion)
// and the 500 no longer leaks raw error text.
import { requireSelf } from "@/lib/server/jwt";
import { checkDrugInteractions } from "@/lib/server/drug-interactions";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const { pillName } = await readJson<{ pillName?: string }>(req);

    if (!pillName?.trim()) {
      return json({ success: false, message: "pillName is required" }, 400);
    }

    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    const existingMedications = await db.medication.findMany({
      where: { userId },
      select: { pillName: true },
    });
    const existingNames = existingMedications.map((m) => m.pillName);

    if (existingNames.length === 0) {
      return json({
        success: true,
        safe: true,
        interactions: [],
        highestSeverity: "none",
        source: "none",
      });
    }

    const result = await checkDrugInteractions(pillName, existingNames);
    return json({ success: true, ...result });
  } catch (error) {
    console.error("[SafetyShield] checkInteractions error:", error);
    return json({ success: false, message: "Interaction check failed" }, 500);
  }
}

export const POST = withMetrics("POST /api/medicine/check-interactions", handler_POST);
