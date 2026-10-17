/**
 * POST /api/medicine/add — port of server/src/api/addMedicineController.js.
 * Includes the "Safety Shield" drug-interaction check and auto-translation
 * of the instructions to es/hi, exactly like the original.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { checkDrugInteractions } from "@/lib/server/drug-interactions";
import translationService from "@/lib/server/translation";
import startNotificationScheduler from "@/lib/server/notifications";
import { serializeMedication, parseJson, type DosageTime, type AdherenceRecord } from "@/lib/server/serialize";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{
      medication?: Record<string, unknown>;
      localuser?: { id?: string; name?: string; email?: string };
    }>(req);

    const medication = (body.medication || {}) as Record<string, unknown>;
    // Phase 12 — BOLA guard: medications are created only for the caller.
    const guard = await requireSelf(req, body.localuser?.id ?? null);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    // MR-2 central fix (2026-10-01): validate BEFORE anything else — an empty
    // pillName previously slipped through as a 201 (and a MISSING pillName
    // crashed at the Prisma create with a raw 500 leaking internals). Same
    // contract as /api/medicine/update.
    const rawName = (medication.pillName as unknown) ?? "";
    const pillName = typeof rawName === "string" ? rawName.trim() : "";
    if (!pillName) {
      return json({ success: false, message: "pillName is required" }, 400);
    }

    const {
      pillDescription,
      dosageDays,
      dosageTimes,
      dosageAmount,
      frequency,
      startDate,
      endDate,
      doctorName,
      prescriptionId,
      adherenceHistory,
      notes,
      overrideInteractionWarning = false,
    } = medication as {
      pillDescription?: string;
      dosageDays?: string[];
      dosageTimes?: DosageTime[];
      dosageAmount?: string;
      frequency?: string | number;
      startDate?: string;
      endDate?: string | null;
      doctorName?: string;
      prescriptionId?: string;
      adherenceHistory?: AdherenceRecord[];
      notes?: string;
      overrideInteractionWarning?: boolean;
    };

    // ─── SAFETY SHIELD ────────────────────────────────────────────────────
    const existingMedications = await db.medication.findMany({
      where: { userId },
      select: { pillName: true },
    });
    const existingNames = existingMedications.map((m) => m.pillName);

    if (existingNames.length > 0 && !overrideInteractionWarning) {
      const interactionResult = await checkDrugInteractions(pillName, existingNames);
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
              ? "Major drug interaction detected. Please consult your doctor before adding this medication."
              : "Drug interaction detected. Please review and confirm to proceed.",
          },
          409
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    // 🌐 Auto-translate pillDescription
    let translatedAr: string | null = null;
    if (pillDescription && pillDescription.trim().length > 0) {
      try {
        const translations = await translationService.translateBatch(
          [pillDescription],
          ["ar"],
          "medication"
        );
        translatedAr = translations[0] || pillDescription;
      } catch (translationError) {
        console.error("⚠️ Translation failed, storing original only:", translationError);
        translatedAr = pillDescription;
      }
    }

    const created = await db.medication.create({
      data: {
        userId,
        pillName,
        pillDescription: pillDescription ?? null,
        originalInstructions: pillDescription || "",
        translatedAr,
        dosageDays: JSON.stringify(dosageDays ?? []),
        dosageTimes: JSON.stringify(dosageTimes ?? []),
        dosageAmount: dosageAmount ?? null,
        // Defensive coercion — the frontend always sends a string (input.value),
        // but API consumers may send a number; coerce instead of a raw 500.
        frequency:
          frequency === null || frequency === undefined
            ? null
            : typeof frequency === "number"
              ? String(frequency)
              : frequency,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        doctorName: doctorName ?? null,
        prescriptionId: prescriptionId ?? null,
        adherenceHistory: JSON.stringify(adherenceHistory ?? []),
        notes: notes ?? null,
      },
    });

    // Google Calendar sync is not available in this sandbox (no OAuth creds),
    // so it is reported as not linked — the medication itself is still saved.
    const calendarSyncStatus = { synced: false, reason: "google-calendar-not-linked" };

    startNotificationScheduler({
      user: { id: userId, name: body.localuser?.name, email: body.localuser?.email },
    });

    const med = await db.medication.findUnique({ where: { id: created.id } });
    return json(
      {
        success: true,
        message: "Medication saved successfully",
        data: med ? serializeMedication(med) : null,
        calendarSync: calendarSyncStatus,
      },
      201
    );
  } catch (error) {
    console.error("Error saving medication:", error);
    return json(
      {
        success: false,
        message: "Server error while saving medication",
      },
      500
    );
  }
}

// keep parseJson referenced for the dosageTimes typing above
void parseJson;

export const POST = withMetrics("POST /api/medicine/add", handler_POST);
