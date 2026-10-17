/**
 * POST /api/dose-events/skip — plan §12 user action: the user deliberately
 * skips a pending dose with an honest reason.
 *
 *   DoseEvent (source of truth) → status "skipped" + skipReason + source "user"
 *   Medication legacy JSON      → dual-write mirror (same pattern as
 *                                 /api/medicine/status) so the original UI
 *                                 keeps working unchanged.
 *
 * The reason is a behavioral signal for the ML layer, never a medical decision.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { parseJson, type DosageTime, type AdherenceRecord } from "@/lib/server/serialize";
import { withMetrics } from "@/lib/server/metrics";

const SKIP_REASONS: readonly string[] = ["forgot", "not_needed", "doctor", "side_effects", "other"];

// MR-13 P0 FIX (Master Review 100, 2026-10-01): this route NEVER compiled —
// `await` inside a non-async resolveUserId (same bug class the snooze route
// had and got fixed; skip was missed). Made async + awaited at the call site.
async function resolveUserId(
  req: Request,
  body: { userId?: string; localuser?: { id?: string; user?: { id?: string } } | string } | null
): Promise<string | null> {
  // Phase 12 — BOLA guard: only the caller's own id is ever accepted.
  const guard = await requireSelf(req, body?.userId ?? null);
  if (guard instanceof Response) return null;
  return guard.id;
}

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{
      doseEventId?: string;
      reason?: string;
      userId?: string;
      localuser?: { id?: string; user?: { id?: string } } | string;
    }>(req);

    const { doseEventId, reason } = body;

    if (!doseEventId) {
      return json({ success: false, message: "Missing dose event id" }, 400);
    }
    if (!reason || !SKIP_REASONS.includes(reason)) {
      return json(
        {
          success: false,
          message: "Invalid reason — must be one of forgot | not_needed | doctor | side_effects | other",
        },
        400
      );
    }

    const userId = await resolveUserId(req, body);
    if (!userId) {
      return json({ success: false, message: "User not authenticated" }, 401);
    }

    const event = await db.doseEvent.findFirst({ where: { id: doseEventId, userId } });
    if (!event) {
      return json({ success: false, message: "Dose event not found" }, 404);
    }
    if (event.status !== "pending") {
      return json(
        {
          success: false,
          message: `Only pending doses can be skipped — this dose is already ${event.status}`,
        },
        409
      );
    }

    const now = new Date();
    const updated = await db.doseEvent.update({
      where: { id: event.id },
      data: {
        status: "skipped",
        skipReason: reason,
        actualAt: now,
        source: "user",
      },
    });

    // Dual-write legacy mirror (non-fatal — mirrors /api/medicine/status):
    // update the matching dosageTimes slot and append an adherenceHistory
    // record so the original UI keeps rendering the outcome.
    try {
      const medicine = await db.medication.findFirst({ where: { id: event.medicationId, userId } });
      if (medicine) {
        const doses = parseJson<DosageTime[]>(medicine.dosageTimes, []);
        const history = parseJson<AdherenceRecord[]>(medicine.adherenceHistory, []);
        const dose = doses.find((d) => d.time === event.slotTime);
        if (dose) {
          dose.status = "skipped";
          dose.skipReason = reason;
          dose.takenAt = null;
        }
        history.push({
          date: now.toISOString(),
          time: event.slotTime,
          status: "skipped",
          takenAt: null,
        });
        await db.medication.update({
          where: { id: medicine.id },
          data: {
            dosageTimes: JSON.stringify(doses),
            adherenceHistory: JSON.stringify(history),
          },
        });
      }
    } catch (err) {
      console.warn("[dose-events/skip] legacy mirror failed (non-fatal):", err);
    }

    return json({
      success: true,
      doseEvent: { id: updated.id, status: updated.status, skipReason: updated.skipReason },
    });
  } catch (err) {
    console.error(err);
    return json({ success: false, message: "Server error while skipping dose" }, 500);
  }
}

export const POST = withMetrics("POST /api/dose-events/skip", handler_POST);
