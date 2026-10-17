/**
 * Phase 3 (master plan) — user timezone application.
 *
 * `User.timeZone` existed since the Mongoose port but was never set by any
 * UI and never used for scheduling. This module is the write path:
 *
 *   - validated (IANA) and persisted on the user row;
 *   - captured automatically at login/signup (client sends
 *     `Intl.DateTimeFormat().resolvedOptions().timeZone`);
 *   - overridable from Settings via PUT /api/preferences/timezone;
 *   - applied SAFELY: only FUTURE pending scheduler rows are rebuilt in the
 *     new zone. Past/resolved rows are historical facts at their original
 *     interpretation and are never rewritten — combined with the
 *     "no retroactive fabrication" rule in materializeDoseEvents, a timezone
 *     change can never duplicate or rewrite a past dose.
 */

import { db } from "@/lib/db";
import { normalizeTimeZone, getUserTimeZone } from "./tz";
import { materializeDoseEvents } from "./dose-events";

export async function applyUserTimeZone(
  userId: string,
  timeZone: string | null | undefined
): Promise<{ changed: boolean; timeZone: string }> {
  const requested = normalizeTimeZone(timeZone);
  const current = await getUserTimeZone(userId);
  if (!requested || requested === current) {
    return { changed: false, timeZone: current };
  }

  await db.user.update({ where: { id: userId }, data: { timeZone: requested } });

  // Rebuild only the future pending scheduler window in the new zone.
  const now = new Date();
  const stale = await db.doseEvent.findMany({
    where: { userId, status: "pending", source: "scheduler", scheduledAt: { gt: now } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const ids = stale.map((s) => s.id);
    // Unscheduled (logged, never delivered) reminders for deleted future
    // doses would be orphaned — remove them. Sent reminders are immutable
    // history and their doses are resolved, so they are never in this set.
    await db.smartReminder.deleteMany({ where: { doseEventId: { in: ids }, status: "logged" } });
    // MR-11 central fix (2026-10-01): RiskPredictions pointed at those future
    // doses were left behind (84 orphans accumulated via this path + the test
    // suite's identical cleanup). Delete them with the doses they describe.
    await db.riskPrediction.deleteMany({ where: { doseEventId: { in: ids } } });
    await db.doseEvent.deleteMany({ where: { id: { in: ids } } });
  }

  const to = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  await materializeDoseEvents(userId, now, to, requested);

  return { changed: true, timeZone: requested };
}
