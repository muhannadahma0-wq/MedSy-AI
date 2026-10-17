/**
 * POST /api/dose-events/snooze — plan §11 user action: the user asks to be
 * reminded again about a pending dose in N minutes (default 10).
 *
 * Creates a SmartReminder { type: "snooze", mode: "live" } — user-requested
 * reminders deliver even while the adaptive engine stays in shadow mode (the
 * engine's delivery loop treats snooze as basic functionality and cancels it
 * if the dose was resolved before it fires).
 *
 * Idempotency: the unique constraint (doseEventId, type, scheduledAt) is the
 * final guard — a P2002-style create error returns the existing row as
 * success (same contract the engine uses).
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { getUserNotificationLanguage, renderNotif } from "@/lib/server/notifications";

// NOTE (task 2-c): this helper contained `await` inside a NON-async
// function — a pre-existing parse error that made every snooze request 500
// before the route could even compile. Fixed to async so the localized
// snooze confirmation below can actually be delivered.
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
      minutes?: number;
      userId?: string;
      localuser?: { id?: string; user?: { id?: string } } | string;
    }>(req);

    const { doseEventId } = body;

    if (!doseEventId) {
      return json({ success: false, message: "Missing dose event id" }, 400);
    }

    let minutes = 10;
    if (body.minutes !== undefined) {
      const m = body.minutes;
      if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 120) {
        return json({ success: false, message: "minutes must be an integer between 1 and 120" }, 400);
      }
      minutes = m;
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
          message: `Only pending doses can be snoozed — this dose is already ${event.status}`,
        },
        409
      );
    }

    const now = new Date();
    const scheduledAt = new Date(now.getTime() + minutes * 60 * 1000);

    const med = await db.medication.findUnique({ where: { id: event.medicationId } });
    // v5 item 50 — snooze confirmation localized per recipient language
    // (User.preferredLanguage → ar/en). The medication name is inserted AS-IS
    // (never translated); the frontend renders it with dir=auto/bdi.
    const language = await getUserNotificationLanguage(userId);
    const pillName = med?.pillName || (language === "ar" ? "الدواء" : "medication");
    const payload = JSON.stringify({
      title: renderNotif("snooze.title", language, { med: pillName }),
      message: renderNotif("snooze.msg", language, { med: pillName, slotTime: event.slotTime }),
    });

    try {
      const reminder = await db.smartReminder.create({
        data: {
          userId,
          doseEventId: event.id,
          type: "snooze",
          scheduledAt,
          status: "logged",
          mode: "live", // user-requested: delivers even in engine shadow mode
          riskScore: event.riskScore,
          riskLevel: event.riskLevel,
          payload,
        },
      });
      return json({
        success: true,
        reminder: { id: reminder.id, type: "snooze", scheduledAt: reminder.scheduledAt.toISOString() },
      });
    } catch (err) {
      // P2002-style unique violation on (doseEventId, type, scheduledAt): the
      // exact same snooze was already requested — return the existing row as
      // success. Anything else rethrows to the 500 handler.
      const existing = await db.smartReminder.findUnique({
        where: {
          doseEventId_type_scheduledAt: { doseEventId: event.id, type: "snooze", scheduledAt },
        },
      });
      if (existing) {
        return json({
          success: true,
          reminder: { id: existing.id, type: "snooze", scheduledAt: existing.scheduledAt.toISOString() },
        });
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    return json({ success: false, message: "Server error while snoozing reminder" }, 500);
  }
}

export const POST = withMetrics("POST /api/dose-events/snooze", handler_POST);
