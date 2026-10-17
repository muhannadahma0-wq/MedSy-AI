/**
 * POST /api/medicine/delete — lifecycle completion for the medication plan.
 *
 * Deletes ONE medication owned by the caller (BOLA-guarded) and cascades the
 * cleanup to every derived row so the analytics/ML pipeline stays referentially
 * clean (verify-data orphan checks stay green):
 *
 *   Medication ─┬─ DoseEvent (medicationId)
 *               ├─ SmartReminder (doseEventId → via DoseEvent ids)
 *               └─ RiskPrediction (doseEventId → via DoseEvent ids)
 *
 * Historical adherence is intentionally removed with the medication — deleting
 * a medication is an explicit user decision to retire that regimen from the
 * plan AND its tracked history (the study cohort accounts for attrition).
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{ medId?: string; medicationId?: string }>(req);
    const medId = body.medId || body.medicationId;

    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    if (!medId || typeof medId !== "string") {
      return json(
        { success: false, message: "Missing medication id (medId)" },
        400
      );
    }

    // BOLA: scoped lookup — a foreign medication id is simply "not found".
    const medicine = await db.medication.findFirst({
      where: { id: medId, userId },
    });
    if (!medicine) {
      return json(
        { success: false, message: "Medicine not found" },
        404
      );
    }

    // ── Cascade cleanup ─────────────────────────────────────────────────
    // 1. DoseEvents of this medication (their ids unlock the ledgers below).
    const doseEvents = await db.doseEvent.findMany({
      where: { medicationId: medicine.id },
      select: { id: true },
    });
    const doseEventIds = doseEvents.map((d) => d.id);

    let deletedReminders = 0;
    let deletedPredictions = 0;
    if (doseEventIds.length > 0) {
      const rem = await db.smartReminder.deleteMany({
        where: { doseEventId: { in: doseEventIds } },
      });
      deletedReminders = rem.count;
      const pred = await db.riskPrediction.deleteMany({
        where: { doseEventId: { in: doseEventIds } },
      });
      deletedPredictions = pred.count;
    }
    const deletedEvents = await db.doseEvent.deleteMany({
      where: { medicationId: medicine.id },
    });

    // 2. The medication row itself.
    await db.medication.delete({ where: { id: medicine.id } });

    return json({
      success: true,
      message: "Medication deleted successfully",
      data: {
        id: medicine.id,
        pillName: medicine.pillName,
        removed: {
          doseEvents: deletedEvents.count,
          smartReminders: deletedReminders,
          riskPredictions: deletedPredictions,
        },
      },
    });
  } catch (error) {
    console.error("Error deleting medication:", error);
    return json(
      {
        success: false,
        message: "Server error while deleting medication",
      },
      500
    );
  }
}

export const POST = withMetrics("POST /api/medicine/delete", handler_POST);
