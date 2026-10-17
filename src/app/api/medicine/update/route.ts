/**
 * POST /api/medicine/update — edit an existing medication of the caller.
 *
 * Logical guarantees (same safety posture as /api/medicine/add):
 *   • BOLA: scoped lookup (id + userId) — foreign ids are "not found".
 *   • Safety Shield: a RENAME re-runs the drug-interaction check against the
 *     user's OTHER medications (409 + blocked on major, unless the client
 *     explicitly sends overrideInteractionWarning after reviewing).
 *   • Localization: a changed description is re-translated to Arabic (same
 *     contract as add).
 *   • Schedule integrity: when dosageDays / dosageTimes / startDate / endDate
 *     change, future PENDING DoseEvents of the old schedule are removed and
 *     the upcoming window is re-materialized from the new schedule
 *     (idempotent). Past/confirmed doses are NEVER rewritten — history stays
 *     honest, exactly like the migration rules in dose-events.ts.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { checkDrugInteractions } from "@/lib/server/drug-interactions";
import translationService from "@/lib/server/translation";
import { serializeMedication, parseJson, type DosageTime } from "@/lib/server/serialize";
import { ensureUpcomingDoseEvents } from "@/lib/server/dose-events";
import { withMetrics } from "@/lib/server/metrics";

interface UpdateBody {
  medId?: string;
  medicationId?: string;
  updates?: {
    pillName?: string;
    pillDescription?: string;
    dosageDays?: string[];
    dosageTimes?: DosageTime[];
    dosageAmount?: string;
    frequency?: string | number;
    startDate?: string;
    endDate?: string | null;
    doctorName?: string;
    notes?: string;
    overrideInteractionWarning?: boolean;
  };
}

async function handler_POST(req: Request) {
  try {
    const body = await readJson<UpdateBody>(req);
    const medId = body.medId || body.medicationId;
    const updates = body.updates ?? {};

    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    if (!medId || typeof medId !== "string") {
      return json(
        { success: false, message: "Missing medication id (medId)" },
        400
      );
    }

    const medicine = await db.medication.findFirst({
      where: { id: medId, userId },
    });
    if (!medicine) {
      return json({ success: false, message: "Medicine not found" }, 404);
    }

    // ── Collect + validate the changed fields only (partial update) ──────
    const data: Record<string, unknown> = {};
    const patch = updates as Record<string, unknown>;

    const renameTo =
      typeof patch.pillName === "string" ? patch.pillName.trim() : null;

    if (renameTo !== null) {
      if (renameTo.length === 0) {
        return json(
          { success: false, message: "Medication name cannot be empty" },
          400
        );
      }
      data.pillName = renameTo;
    }

    if (typeof patch.dosageAmount === "string") data.dosageAmount = patch.dosageAmount;
    if (patch.frequency !== undefined) {
      // Defensive coercion — same contract as /api/medicine/add.
      data.frequency =
        patch.frequency === null
          ? null
          : typeof patch.frequency === "number"
            ? String(patch.frequency)
            : (patch.frequency as string);
    }
    if (typeof patch.doctorName === "string") data.doctorName = patch.doctorName;
    if (typeof patch.notes === "string") data.notes = patch.notes;

    let descriptionChanged = false;
    if (typeof patch.pillDescription === "string") {
      data.pillDescription = patch.pillDescription;
      data.originalInstructions = patch.pillDescription;
      descriptionChanged =
        patch.pillDescription.trim() !==
        (medicine.originalInstructions ?? medicine.pillDescription ?? "").trim();
    }

    // Schedule fields — validated shapes, then flagged for re-materialization.
    let scheduleChanged = false;
    if (Array.isArray(patch.dosageDays)) {
      const days = (patch.dosageDays as unknown[]).filter(
        (d): d is string => typeof d === "string"
      );
      data.dosageDays = JSON.stringify(days);
      const oldDays = parseJson<string[]>(medicine.dosageDays, []);
      if (JSON.stringify(days) !== JSON.stringify(oldDays)) scheduleChanged = true;
    }
    if (Array.isArray(patch.dosageTimes)) {
      const times = (patch.dosageTimes as unknown[]).filter(
        (t): t is DosageTime =>
          !!t && typeof t === "object" && typeof (t as DosageTime).time === "string"
      );
      if (times.length === 0) {
        return json(
          { success: false, message: "A medication needs at least one dosage time" },
          400
        );
      }
      data.dosageTimes = JSON.stringify(times);
      const oldTimes = parseJson<DosageTime[]>(medicine.dosageTimes, []);
      const norm = (ts: DosageTime[]) => ts.map((x) => x.time).join(",");
      if (norm(times) !== norm(oldTimes)) scheduleChanged = true;
    }
    if (typeof patch.startDate === "string" && patch.startDate) {
      const d = new Date(patch.startDate);
      if (Number.isNaN(d.getTime())) {
        return json({ success: false, message: "Invalid startDate" }, 400);
      }
      data.startDate = d;
      if (d.getTime() !== medicine.startDate.getTime()) scheduleChanged = true;
    }
    if (patch.endDate !== undefined) {
      if (patch.endDate === null || patch.endDate === "") {
        data.endDate = null;
        if (medicine.endDate !== null) scheduleChanged = true;
      } else {
        const d = new Date(patch.endDate as string);
        if (Number.isNaN(d.getTime())) {
          return json({ success: false, message: "Invalid endDate" }, 400);
        }
        data.endDate = d;
        if (!medicine.endDate || d.getTime() !== medicine.endDate.getTime()) {
          scheduleChanged = true;
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return json(
        {
          success: false,
          message: "No updatable fields supplied",
        },
        400
      );
    }

    // ── SAFETY SHIELD (rename only) ─────────────────────────────────────
    if (renameTo !== null && renameTo.toLowerCase() !== medicine.pillName.toLowerCase()) {
      const otherMeds = await db.medication.findMany({
        where: { userId, id: { not: medicine.id } },
        select: { pillName: true },
      });
      const otherNames = otherMeds.map((m) => m.pillName);
      if (otherNames.length > 0 && !updates.overrideInteractionWarning) {
        const interactionResult = await checkDrugInteractions(renameTo, otherNames);
        if (!interactionResult.safe) {
          const hasMajor = interactionResult.highestSeverity === "major";
          return json(
            {
              success: false,
              interactionDetected: true,
              blocked: hasMajor,
              highestSeverity: interactionResult.highestSeverity,
              interactions: interactionResult.interactions,
              message: hasMajor
                ? "Major drug interaction detected. Please consult your doctor before renaming to this medication."
                : "Drug interaction detected. Please review and confirm to proceed.",
            },
            409
          );
        }
      }
    }

    // ── Re-translate when the description changed ───────────────────────
    if (descriptionChanged) {
      const newDescription = (data.pillDescription as string) ?? "";
      if (newDescription.trim().length > 0) {
        try {
          const translations = await translationService.translateBatch(
            [newDescription],
            ["ar"],
            "medication"
          );
          data.translatedAr = translations[0] || newDescription;
        } catch (translationError) {
          console.error("⚠️ Re-translation failed, keeping original:", translationError);
          data.translatedAr = newDescription;
        }
      } else {
        data.translatedAr = null;
      }
    }

    // ── Persist ──────────────────────────────────────────────────────────
    const updated = await db.medication.update({
      where: { id: medicine.id },
      data,
    });

    // ── Schedule re-materialization (additive, history-preserving) ───────
    let rescheduled = 0;
    if (scheduleChanged) {
      // Only FUTURE PENDING rows of the old schedule are removed — confirmed
      // outcomes and past slots are the honest record and stay untouched.
      const futurePending = await db.doseEvent.findMany({
        where: {
          medicationId: medicine.id,
          status: "pending",
          scheduledAt: { gte: new Date() },
        },
        select: { id: true },
      });
      if (futurePending.length > 0) {
        const ids = futurePending.map((d) => d.id);
        // Their reminder/prediction ledgers would dangle — clean them first
        // (same cascade order as /api/medicine/delete, scoped to these rows).
        await db.smartReminder.deleteMany({ where: { doseEventId: { in: ids } } });
        await db.riskPrediction.deleteMany({ where: { doseEventId: { in: ids } } });
        await db.doseEvent.deleteMany({ where: { id: { in: ids } } });
      }
      rescheduled = await ensureUpcomingDoseEvents(userId);
    }

    const med = await db.medication.findUnique({ where: { id: updated.id } });
    return json({
      success: true,
      message: "Medication updated successfully",
      data: med ? serializeMedication(med) : null,
      rescheduledDoseEvents: rescheduled,
    });
  } catch (error) {
    console.error("Error updating medication:", error);
    return json(
      {
        success: false,
        message: "Server error while updating medication",
      },
      500
    );
  }
}

export const POST = withMetrics("POST /api/medicine/update", handler_POST);
