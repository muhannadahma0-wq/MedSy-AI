/**
 * MEDSYNC-004 — Unified Reminder Engine (idempotent, restart-safe).
 * MEDSYNC-008 — Shadow mode: decisions logged, nothing delivered.
 * MEDSYNC-009 — Explanations travel with every risk-aware reminder payload.
 * MEDSYNC-010 — Smart reminders: high-risk doses get an EXTRA escalation.
 *
 * Pipeline per tick:
 *   1. materialize the scheduling window for each user (idempotent upserts)
 *   2. auto-transition stale pending doses → missed (honest "not confirmed")
 *   3. risk-score pending doses in the horizon (persisted RiskPrediction rows)
 *   4. plan SmartReminder rows idempotently — unique (doseEventId, type,
 *      scheduledAt) makes replays after a restart harmless by construction
 *   5. deliver due reminders ONLY in "live" mode (socket bridge +
 *      DailyNotification); in "shadow" mode rows stay status="logged"
 *
 * The legacy in-memory setTimeout scheduler (notifications.ts) is superseded:
 * its personalized message generator + DailyNotification persistence are
 * reused verbatim, but delivery decisions now live in the database.
 */

import { db } from "@/lib/db";
import { createHmac } from "crypto";
import { parseJson, type DosageTime } from "./serialize";
import { autoTransitionMissed, ensureUpcomingDoseEvents } from "./dose-events";
import { persistPrediction } from "./ml/predict";
// MR-15 central fix (2026-10-01): the engine now uses the CONSENT-GATED
// effective arm — a smart-arm participant without ACTIVE research consent is
// treated as control, so EXTRA escalation (the study intervention) is never
// delivered to a non-consented user even if SMART_REMINDERS=live. Export
// filtering and the research overview already used this gate.
import { getEffectiveStudyArm } from "./study";
import { getUserTimeZone, dateKeyInZone, dayNameInZone } from "./tz";
import {
  generatePersonalizedNotification,
  getUserNotificationLanguage,
  persistNotification,
  renderNotif,
  timeStringForLanguage,
  type NotifLanguage,
} from "./notifications";

// Full URL of the socket service's internal emit bridge (loopback only).
// NOTE (Task 13 fix): the previous fetch appended "/emit" to this constant,
// producing POST /emit/emit → 404, so NO reminder (snooze included) ever
// reached the socket service. The constant already carries the full path.
const SOCKET_EMIT_BRIDGE = "http://127.0.0.1:3004/emit";

/** Reminder planning horizon (hours ahead). */
const PLAN_HOURS = 12;
/** Risk scoring horizon (hours ahead) — matches the Intelligence UI forecast. */
const SCORE_HOURS = 48;
/** A logged reminder older than this is "skipped" on recovery, not delivered. */
const LATE_DELIVERY_LIMIT_MS = 15 * 60 * 1000;
/** Rescore a pending dose at most every 6h (in-memory; restart rescores once). */
const RESCORE_AFTER_MS = 6 * 3600 * 1000;
/** High-risk extra reminder offset after the scheduled time. */
const EXTRA_OFFSET_MS = 15 * 60 * 1000;

export type EngineMode = "shadow" | "live";

export function getEngineMode(): EngineMode {
  return process.env.SMART_REMINDERS === "live" ? "live" : "shadow";
}

export interface TickSummary {
  mode: EngineMode;
  users: number;
  materialized: number;
  transitioned: number;
  scored: number;
  planned: number;
  delivered: number;
  skippedStale: number;
  suppressedExtra: number; // EXTRA reminders withheld because the user is in the CONTROL arm (plan §27)
  ranAt: string;
}

const scoredRecently = new Map<string, number>();

function parseDuration(str: string | undefined): number {
  if (!str) return 0;
  const unit = str.slice(-1);
  const value = parseInt(str, 10);
  if (Number.isNaN(value)) return 0;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return 0;
}

interface PlannedReminder {
  userId: string;
  doseEventId: string;
  type: "before" | "onTime" | "after" | "extra";
  scheduledAt: Date;
  riskScore: number | null;
  riskLevel: string | null;
}

async function emitSocketNotification(
  userId: string,
  notification: { title: string; message: string; type: string; doseEventId?: string }
): Promise<boolean> {
  try {
    const body = JSON.stringify({
      userId,
      notification: {
        ...notification,
        timestamp: new Date().toISOString(),
        id: Date.now() + Math.random(),
      },
    });
    // MR-19 central fix (2026-10-01): sign the bridge request with the shared
    // JWT_SECRET — the /emit endpoint on :3004 now rejects unsigned calls.
    const signature = createHmac("sha256", process.env.JWT_SECRET || "medsync-ai-sandbox-secret")
      .update(body)
      .digest("hex");
    const res = await fetch(SOCKET_EMIT_BRIDGE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-emit-signature": signature },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Honest risk-aware message for the EXTRA (high-risk) reminder.
 * v5 item 50 — rendered in the recipient's language (ar/en) from the shared
 * NOTIF_TEXT templates; the medication name is inserted AS-IS (never
 * translated — the frontend renders it with dir=auto/bdi isolation).
 * Exported for the notification-l10n test suite (scripts/test-notif-l10n.ts).
 */
export function craftExtraMessage(params: {
  pillName: string;
  timeStr: string;
  language: NotifLanguage;
  missedLast7d?: number;
  slotMissStreak?: number;
  reasonEn?: string;
}): { title: string; message: string } {
  const reasons: string[] = [];
  if (params.missedLast7d && params.missedLast7d > 0) {
    reasons.push(
      renderNotif("extra.reason.missed7d", params.language, {
        med: params.pillName,
        missedLast7d: params.missedLast7d,
      })
    );
  }
  if (params.slotMissStreak && params.slotMissStreak > 0) {
    reasons.push(
      renderNotif("extra.reason.slotStreak", params.language, {
        med: params.pillName,
        slotMissStreak: params.slotMissStreak,
      })
    );
  }
  // Arabic list separator is the Arabic semicolon «؛».
  const reasonText = reasons.length > 0 ? ` (${reasons.join(params.language === "ar" ? "؛ " : "; ")})` : "";
  return {
    title: renderNotif("extra.title", params.language, { med: params.pillName }),
    message: renderNotif("extra.msg", params.language, {
      med: params.pillName,
      time: params.timeStr,
      reasonText,
    }),
  };
}

async function deliverReminder(reminder: {
  userId: string;
  doseEventId: string;
  type: string;
  payload: string | null;
  mode: EngineMode;
}): Promise<"sent" | "failed"> {
  let payload: { title: string; message: string } | null = null;
  try {
    payload = reminder.payload ? (JSON.parse(reminder.payload) as { title: string; message: string }) : null;
  } catch {
    payload = null;
  }
  if (!payload) return "failed";

  const ok = await emitSocketNotification(reminder.userId, {
    title: payload.title,
    message: payload.message,
    type: reminder.type,
    doseEventId: reminder.doseEventId,
  });
  if (!ok) return "failed";

  const now = new Date();
  const tz = await getUserTimeZone(reminder.userId);
  const todayDay = dayNameInZone(now, tz);
  await persistNotification(reminder.userId, dateKeyInZone(now, tz), todayDay, {
    title: payload.title,
    message: payload.message,
    type: reminder.type as "before" | "onTime" | "after" | "test",
    time: now.toISOString(),
  });
  return "sent";
}

/**
 * Plans the idempotent reminder set for one pending dose event.
 * Normal set: before/onTime/after from the medication's own remindBefore /
 * remindAfter. Extra: only for high-risk doses AND only for participants in
 * the SMART study arm (plan §27 — control never receives EXTRA).
 */
async function planRemindersForEvent(params: {
  userId: string;
  event: { id: string; medicationId: string; scheduledAt: Date; slotTime: string; riskScore: number | null; riskLevel: string | null };
  med: { id: string; pillName: string; dosageTimes: unknown } | null;
  mode: EngineMode;
  arm: "control" | "smart";
  now: Date;
  timeZone: string;
  language: NotifLanguage; // v5 item 50 — recipient's notification language
  onSuppressedExtra?: () => void;
}): Promise<number> {
  const { userId, event, med, mode, arm, now, timeZone } = params;
  if (!med) return 0;

  const doses = parseJson<DosageTime[]>(med.dosageTimes, []);
  const slot = doses.find((d) => d.time === event.slotTime) ?? doses[0];
  const beforeMs = slot ? parseDuration(slot.remindBefore) : 15 * 60 * 1000;
  const afterMs = slot ? parseDuration(slot.remindAfter) : 30 * 60 * 1000;

  const planned: PlannedReminder[] = [];
  const beforeAt = new Date(event.scheduledAt.getTime() - beforeMs);
  if (beforeMs > 0) planned.push({ userId, doseEventId: event.id, type: "before", scheduledAt: beforeAt, riskScore: event.riskScore, riskLevel: event.riskLevel });
  planned.push({ userId, doseEventId: event.id, type: "onTime", scheduledAt: event.scheduledAt, riskScore: event.riskScore, riskLevel: event.riskLevel });
  const afterAt = new Date(event.scheduledAt.getTime() + afterMs);
  if (afterMs > 0) planned.push({ userId, doseEventId: event.id, type: "after", scheduledAt: afterAt, riskScore: event.riskScore, riskLevel: event.riskLevel });
  if (event.riskLevel === "high") {
    if (arm === "smart") {
      planned.push({
        userId,
        doseEventId: event.id,
        type: "extra",
        scheduledAt: new Date(event.scheduledAt.getTime() + EXTRA_OFFSET_MS),
        riskScore: event.riskScore,
        riskLevel: event.riskLevel,
      });
    } else {
      // CONTROL arm: the dose is still scored and logged, but the EXTRA
      // reminder is withheld — that withholding IS the experiment (§27).
      params.onSuppressedExtra?.();
    }
  }

  // Personalized payloads (original generator, reused verbatim).
  const medLike = med as unknown as { id: string; pillName: string; dosageTimes: unknown; adherenceHistory: unknown };
  let created = 0;
  for (const p of planned) {
    // Only plan reminders that can still fire (skip fully-stale ones).
    if (p.scheduledAt.getTime() < now.getTime() - LATE_DELIVERY_LIMIT_MS) continue;

    let payload: { title: string; message: string } | null = null;
    if (p.type === "extra") {
      const timeStr = timeStringForLanguage(event.scheduledAt, timeZone, params.language);
      // Read the honest top features from the latest prediction.
      const latest = await db.riskPrediction.findFirst({
        where: { doseEventId: event.id },
        orderBy: { createdAt: "desc" },
      });
      let missedLast7d: number | undefined;
      let slotMissStreak: number | undefined;
      if (latest?.features) {
        try {
          const f = JSON.parse(latest.features) as Record<string, number>;
          missedLast7d = f.missedLast7d;
          slotMissStreak = f.slotMissStreak;
        } catch {
          /* honest fallback: no reasons appended */
        }
      }
      payload = craftExtraMessage({ pillName: med.pillName, timeStr, language: params.language, missedLast7d, slotMissStreak });
    } else {
      payload = await generatePersonalizedNotification(
        userId,
        medLike,
        p.type,
        event.scheduledAt,
        timeZone,
        params.language
      );
    }

    try {
      // Idempotency: existence check first (keeps logs clean); the unique
      // constraint on (doseEventId, type, scheduledAt) is the final guard.
      const existing = await db.smartReminder.findUnique({
        where: {
          doseEventId_type_scheduledAt: {
            doseEventId: event.id,
            type: p.type,
            scheduledAt: p.scheduledAt,
          },
        },
      });
      if (existing) {
        // Already planned: refresh the risk snapshot while still logged
        // (a SENT reminder is an immutable historical record).
        if (existing.status === "logged") {
          await db.smartReminder.update({
            where: { id: existing.id },
            data: {
              riskScore: p.riskScore,
              riskLevel: p.riskLevel,
              payload: JSON.stringify(payload),
            },
          });
        }
        continue;
      }
      await db.smartReminder.create({
        data: {
          userId,
          doseEventId: event.id,
          type: p.type,
          scheduledAt: p.scheduledAt,
          status: "logged",
          mode,
          riskScore: p.riskScore,
          riskLevel: p.riskLevel,
          payload: JSON.stringify(payload),
        },
      });
      created++;
    } catch {
      // P2002 unique violation in a concurrent tick — already planned.
    }
  }
  return created;
}

export async function runEngineTick(userIds?: string[]): Promise<TickSummary> {
  const mode = getEngineMode();
  const now = new Date();
  const summary: TickSummary = {
    mode,
    users: 0,
    materialized: 0,
    transitioned: 0,
    scored: 0,
    planned: 0,
    delivered: 0,
    skippedStale: 0,
    suppressedExtra: 0,
    ranAt: now.toISOString(),
  };

  const users =
    userIds && userIds.length > 0
      ? userIds
      : (await db.medication.findMany({ select: { userId: true }, distinct: ["userId"] })).map((m) => m.userId);

  const planFrom = new Date(now.getTime() - LATE_DELIVERY_LIMIT_MS);
  const planTo = new Date(now.getTime() + PLAN_HOURS * 3600 * 1000);
  const scoreTo = new Date(now.getTime() + SCORE_HOURS * 3600 * 1000);

  for (const userId of users) {
    summary.users++;
    // Study arm (plan §27) + timezone (Phase 3) + notification language
    // (v5 item 50) — resolved once per tick per user.
    const [{ arm }, timeZone, language] = await Promise.all([
      getEffectiveStudyArm(userId),
      getUserTimeZone(userId),
      getUserNotificationLanguage(userId),
    ]);
    // 1. Materialize the window + 2. outcomes for stale pending doses.
    summary.materialized += await ensureUpcomingDoseEvents(userId);
    summary.transitioned += await autoTransitionMissed(userId);

    const meds = await db.medication.findMany({ where: { userId } });
    const medById = new Map(meds.map((m) => [m.id, m]));

    // 3. Risk scoring for pending doses in the horizon (rate-limited).
    const toScore = await db.doseEvent.findMany({
      where: {
        userId,
        status: "pending",
        scheduledAt: { gte: new Date(now.getTime() - 2 * 3600 * 1000), lte: scoreTo },
      },
    });
    for (const e of toScore) {
      const last = scoredRecently.get(e.id);
      if (last && now.getTime() - last < RESCORE_AFTER_MS && e.riskScore !== null) continue;
      const done = await persistPrediction(userId, e.id, mode);
      if (done) {
        scoredRecently.set(e.id, now.getTime());
        summary.scored++;
      }
    }

    // 4. Plan reminders for pending doses in the delivery horizon.
    const pending = await db.doseEvent.findMany({
      where: { userId, status: "pending", scheduledAt: { gte: planFrom, lte: planTo } },
    });
    for (const e of pending) {
      summary.planned += await planRemindersForEvent({
        userId,
        event: {
          id: e.id,
          medicationId: e.medicationId,
          scheduledAt: e.scheduledAt,
          slotTime: e.slotTime,
          riskScore: e.riskScore,
          riskLevel: e.riskLevel,
        },
        med: medById.get(e.medicationId) ?? null,
        mode,
        arm,
        now,
        timeZone,
        language,
        onSuppressedExtra: () => {
          summary.suppressedExtra++;
        },
      });
    }
  }

  // 5. Delivery — LIVE mode only (shadow keeps everything at status="logged").
  const due = await db.smartReminder.findMany({
    where: { status: "logged", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });
  for (const r of due) {
    if (now.getTime() - r.scheduledAt.getTime() > LATE_DELIVERY_LIMIT_MS) {
      await db.smartReminder.update({ where: { id: r.id }, data: { status: "skipped" } });
      summary.skippedStale++;
      continue;
    }
    if (r.mode === "live" && mode === "live") {
      const outcome = await deliverReminder({
        userId: r.userId,
        doseEventId: r.doseEventId,
        type: r.type,
        payload: r.payload,
        mode,
      });
      if (outcome === "sent") {
        await db.smartReminder.update({ where: { id: r.id }, data: { status: "sent", sentAt: new Date() } });
        summary.delivered++;
      }
    } else if (r.type === "snooze") {
      // User-requested snooze (plan §11): the user explicitly asked for this
      // notification, so it delivers even while the adaptive engine stays in
      // shadow mode — snoozing is basic functionality, not an intervention.
      // Guard: if the dose was resolved (taken/skipped/missed) after the user
      // snoozed, the snooze is cancelled instead of delivered.
      const dose = await db.doseEvent.findUnique({ where: { id: r.doseEventId } });
      if (!dose || dose.status !== "pending") {
        await db.smartReminder.update({ where: { id: r.id }, data: { status: "skipped" } });
        summary.skippedStale++;
        continue;
      }
      const outcome = await deliverReminder({
        userId: r.userId,
        doseEventId: r.doseEventId,
        type: r.type,
        payload: r.payload,
        mode,
      });
      if (outcome === "sent") {
        await db.smartReminder.update({ where: { id: r.id }, data: { status: "sent", sentAt: new Date() } });
        summary.delivered++;
      }
    }
    // Shadow mode: leave as "logged" — the decision is recorded, not delivered.
  }

  // Keep the rescore map bounded.
  if (scoredRecently.size > 5000) scoredRecently.clear();

  return summary;
}

// ── Background loop (started from instrumentation.ts) ───────────────────────

let loopTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function startReminderEngineLoop(intervalMs = 60_000): void {
  if (loopTimer) return;
  console.log(`[reminder-engine] started — mode=${getEngineMode()}, interval=${intervalMs}ms`);
  loopTimer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const summary = await runEngineTick();
      if (summary.scored || summary.planned || summary.delivered || summary.transitioned || summary.suppressedExtra) {
        console.log(
          `[reminder-engine] tick ${summary.ranAt}: users=${summary.users} materialized=${summary.materialized} ` +
            `transitioned=${summary.transitioned} scored=${summary.scored} planned=${summary.planned} ` +
            `delivered=${summary.delivered} skippedStale=${summary.skippedStale} suppressedExtra=${summary.suppressedExtra} mode=${summary.mode}`
        );
      }
    } catch (err) {
      console.error("[reminder-engine] tick failed:", err);
    } finally {
      ticking = false;
    }
  }, intervalMs);
  // First tick shortly after boot (recovery after restart).
  setTimeout(async () => {
    try {
      await runEngineTick();
      console.log("[reminder-engine] boot recovery tick completed");
    } catch (err) {
      console.error("[reminder-engine] boot tick failed:", err);
    }
  }, 5_000);
}
