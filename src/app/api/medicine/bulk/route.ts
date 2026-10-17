/**
 * POST /api/medicine/bulk — port of server/src/api/bulkMedicineController.js.
 * (Fixes the original's dangling bug: parseBulkText returns { success, failed },
 * the controller now iterates .success and merges .failed into the response.)
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { parseBulkText } from "@/lib/server/medicine-parser";
import { checkDrugInteractions } from "@/lib/server/drug-interactions";
import startNotificationScheduler from "@/lib/server/notifications";
import { serializeMedication } from "@/lib/server/serialize";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{
      text?: string;
      localuser?: { id?: string; _id?: string; name?: string; email?: string };
    }>(req);

    // Phase 12 — BOLA guard: bulk medications are created only for the caller.
    const guard = await requireSelf(req, body.localuser?.id ?? body.localuser?._id ?? null);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    const parsed = parseBulkText(body.text || "");
    const medicines = parsed.success;

    if (!medicines || medicines.length === 0) {
      return json(
        {
          success: false,
          message: "No valid medication data could be parsed from the text.",
          failed: parsed.failed,
        },
        400
      );
    }

    const success: unknown[] = [];
    const failed: { med: unknown; error: string }[] = parsed.failed.map((f) => ({
      med: f.line,
      error: f.error,
    }));

    // MR-2 central fix (2026-10-01): the bulk path previously bypassed the
    // SAFETY SHIELD that single add enforces — a "Warfarin" line could be
    // bulk-added next to Aspirin with no warning. Each parsed med is now
    // screened against the caller's EXISTING meds + the meds already created
    // in THIS batch. Major interactions block the item (same contract as add:
    // 409 blocked:true); moderate/minor are recorded as a warning on the item
    // so the batch continues (bulk is a convenience flow — the UI shows the
    // flags and the user can still single-add with the explicit override).
    const existing = await db.medication.findMany({
      where: { userId },
      select: { pillName: true },
    });
    const knownNames: string[] = existing.map((m) => m.pillName);
    const interactionWarnings: { med: string; interactions: unknown[] }[] = [];

    for (const med of medicines) {
      try {
        let blockedByInteraction: { interactions: unknown[] } | null = null;
        try {
          const screen = await checkDrugInteractions(med.pillName, knownNames);
          if (!screen.safe && screen.highestSeverity === "major") {
            blockedByInteraction = { interactions: screen.interactions };
          } else if (!screen.safe) {
            interactionWarnings.push({ med: med.pillName, interactions: screen.interactions });
          }
        } catch (screenErr) {
          // A screening failure must never block adding the medication.
          console.warn("[medicine/bulk] interaction screen failed (non-fatal):", screenErr);
        }
        if (blockedByInteraction) {
          failed.push({
            med: med.pillName,
            error: "Major drug interaction detected — add it individually to review and confirm.",
          });
          continue;
        }

        const created = await db.medication.create({
          data: {
            userId,
            pillName: med.pillName,
            pillDescription: med.pillDescription,
            originalInstructions: med.pillDescription,
            dosageDays: JSON.stringify(med.dosageDays),
            dosageTimes: JSON.stringify(med.dosageTimes),
            dosageAmount: med.dosageAmount,
            frequency: med.frequency,
            startDate: med.startDate,
            endDate: med.endDate,
            adherenceHistory: "[]",
          },
        });
        // Later items are screened against this newly added one too.
        knownNames.push(med.pillName);
        success.push(serializeMedication(created));
      } catch (err) {
        console.error("[medicine/bulk] item failed:", err);
        failed.push({ med: med.pillName, error: "Failed to add this medication" });
      }
    }

    startNotificationScheduler({
      user: {
        id: userId,
        name: body.localuser?.name || "User",
        email: body.localuser?.email,
      },
    });

    return json(
      {
        success: true,
        successCount: success.length,
        added: success,
        failed,
        interactionWarnings,
      },
      201
    );
  } catch (err) {
    console.error("Bulk Controller Error:", err);
    return json({ success: false, message: "Server error during bulk add" }, 500);
  }
}

export const POST = withMetrics("POST /api/medicine/bulk", handler_POST);
