/**
 * POST /api/medicine/status — port of server/src/api/statusMedicineController.js.
 * Marks a dose (by index) or all doses of a medication as taken/missed/delayed
 * and appends the event to adherenceHistory.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { parseJson, type DosageTime, type AdherenceRecord } from "@/lib/server/serialize";
import { syncDoseEventFromStatus } from "@/lib/server/dose-events";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{
      localuser?: { id?: string; user?: { id?: string } } | string;
      medId?: string;
      dosageTimeIndex?: number;
      status?: string;
    }>(req);

    const { medId, dosageTimeIndex, status } = body;

    const allowedStatuses = ["taken", "missed", "delayed"];
    if (!status || !allowedStatuses.includes(status)) {
      return json({ success: false, message: "Invalid status" }, 400);
    }

    // Phase 12 — BOLA guard: only the caller's own medications are mutable,
    // and the medication lookup below is additionally scoped by userId.
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    if (!medId) {
      return json({ success: false, message: "Missing user or medication" }, 400);
    }

    const medicine = await db.medication.findFirst({ where: { id: medId, userId } });
    if (!medicine) {
      return json({ success: false, message: "Medicine not found" }, 404);
    }

    const now = new Date();
    const doses = parseJson<DosageTime[]>(medicine.dosageTimes, []);
    const history = parseJson<AdherenceRecord[]>(medicine.adherenceHistory, []);

    if (
      typeof dosageTimeIndex === "number" &&
      Number.isInteger(dosageTimeIndex) &&
      dosageTimeIndex >= 0 &&
      dosageTimeIndex < doses.length
    ) {
      const dose = doses[dosageTimeIndex];
      dose.status = status as DosageTime["status"];
      dose.takenAt = status === "taken" ? now.toISOString() : null;
      history.push({
        date: now.toISOString(),
        time: dose.time,
        status: status as AdherenceRecord["status"],
        takenAt: status === "taken" ? now.toISOString() : null,
      });
    } else {
      doses.forEach((dt) => {
        dt.status = status as DosageTime["status"];
        dt.takenAt = status === "taken" ? now.toISOString() : null;
      });
      history.push({
        date: now.toISOString(),
        time: doses[0]?.time || "",
        status: status as AdherenceRecord["status"],
        takenAt: status === "taken" ? now.toISOString() : null,
      });
    }

    await db.medication.update({
      where: { id: medicine.id },
      data: {
        dosageTimes: JSON.stringify(doses),
        adherenceHistory: JSON.stringify(history),
      },
    });

    // MEDSYNC-003 dual-write: mirror the outcome into today's DoseEvent rows
    // (the analytics/ML source of truth). Legacy JSON fields above stay
    // exactly as the original client expects — this sync is additive.
    try {
      const slots =
        typeof dosageTimeIndex === "number" && doses[dosageTimeIndex]
          ? [doses[dosageTimeIndex].time]
          : [...new Set(doses.map((d) => d.time))];
      for (const slot of slots) {
        await syncDoseEventFromStatus({
          userId,
          medicationId: medicine.id,
          slotTime: slot,
          status: status as "taken" | "missed" | "delayed",
          confirmedAt: now,
        });
      }
    } catch (err) {
      console.warn("[dose-events] status sync failed (non-fatal):", err);
    }

    return json({
      success: true,
      message: "Medication status updated",
      status,
    });
  } catch (err) {
    console.error(err);
    return json({ success: false, message: "Server error while updating medication status" }, 500);
  }
}

export const POST = withMetrics("POST /api/medicine/status", handler_POST);
