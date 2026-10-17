/**
 * GET /api/analytics/[userId] — Analytics 2.0 (master plan Phase 4).
 *
 * REWRITTEN on top of the DoseEvent table (the previous port counted the
 * legacy JSON blobs — planned slots AND adherenceHistory — which double- or
 * triple-counted doses and produced inflated denominators).
 *
 * Research framing (adherence-engine):
 *   confirmed     = taken + delayed (the user recorded the dose)
 *   not confirmed = missed (no confirmation inside the grace window)
 *
 * KPIs (plan Phase 4): confirmation rate, on-time rate, average delay,
 * unconfirmed rate, skipped rate, current + longest streak, by weekday,
 * by hour, by medication, and reminder response time (last sent reminder →
 * confirmation). All day boundaries in the USER's timezone (Phase 3).
 */
import { db } from "@/lib/db";
import { withMetrics } from "@/lib/server/metrics";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import {
  computeStreakFromDoseEvents,
  longestStreakFromDaily,
} from "@/lib/server/adherence-engine";
import {
  getUserTimeZone,
  startOfDayInZone,
  dateKeyInZone,
  hourKeyInZone,
  wallClock,
} from "@/lib/server/tz";

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_LONG = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export const GET = withMetrics("GET /api/analytics", async (
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) => {
  try {
    const { userId } = await params;
    // Phase 12 — BOLA guard: analytics are readable only by their owner.
    const guard = await requireSelf(req, userId);
    if (guard instanceof Response) return guard;
    const uid = guard.id;

    const url = new URL(req.url);
    const daysRaw = parseInt(url.searchParams.get("days") ?? "30", 10);
    const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

    const tz = await getUserTimeZone(uid);
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - (days - 1));
    const from = startOfDayInZone(fromDate, tz);

    const [events, meds, sentReminders, streakDays] = await Promise.all([
      db.doseEvent.findMany({
        where: { userId: uid, scheduledAt: { gte: from } },
        orderBy: { scheduledAt: "asc" },
      }),
      db.medication.findMany({
        where: { userId: uid },
        select: { id: true, pillName: true, dosageAmount: true },
      }),
      db.smartReminder.findMany({
        where: { userId: uid, status: "sent", sentAt: { not: null } },
        select: { doseEventId: true, sentAt: true },
      }),
      computeStreakFromDoseEvents(uid),
    ]);

    const medById = new Map(meds.map((m) => [m.id, m]));

    // Last sent reminder per dose (for response-time measurement).
    const lastReminderByDose = new Map<string, number>();
    for (const r of sentReminders) {
      const t = r.sentAt!.getTime();
      const prev = lastReminderByDose.get(r.doseEventId);
      if (prev === undefined || t > prev) lastReminderByDose.set(r.doseEventId, t);
    }

    // Legacy-compatible status counters (the Analytics page charts these).
    const statusCounts = { taken: 0, missed: 0, delayed: 0, pending: 0, skipped: 0 };
    const byDay: Record<string, Record<string, number>> = {};
    for (const k of WEEKDAY_KEYS) byDay[k] = { taken: 0, missed: 0, delayed: 0, pending: 0, skipped: 0 };

    const hourMap = new Map<string, { total: number; confirmed: number; missed: number }>();
    const medMap = new Map<string, { name: string; total: number; confirmed: number; missed: number; delaySum: number; delayCount: number }>();
    const dayMap = new Map<string, { total: number; confirmed: number; missed: number }>();

    let delaySum = 0;
    let delayCount = 0;
    const responseMinutes: number[] = [];

    for (const e of events) {
      const status = e.status as keyof typeof statusCounts;
      if (!(status in statusCounts)) continue;
      statusCounts[status]++;

      const confirmed = status === "taken" || status === "delayed";
      const isMissed = status === "missed";

      // Weekday bucket (Mon..Sun keys, user timezone).
      const weekdayLong = wallClock(e.scheduledAt, tz).weekday;
      const wdIndex = WEEKDAY_LONG.indexOf(weekdayLong);
      if (wdIndex >= 0) byDay[WEEKDAY_KEYS[wdIndex]][status]++;

      // Hour bucket (user timezone).
      const hour = hourKeyInZone(e.scheduledAt, tz);
      const hb = hourMap.get(hour) ?? { total: 0, confirmed: 0, missed: 0 };
      hb.total++;
      if (confirmed) hb.confirmed++;
      if (isMissed) hb.missed++;
      hourMap.set(hour, hb);

      // Medication bucket.
      const medName = medById.get(e.medicationId)?.pillName ?? "Unknown medication";
      const mb = medMap.get(e.medicationId) ?? {
        name: medName, total: 0, confirmed: 0, missed: 0, delaySum: 0, delayCount: 0,
      };
      mb.total++;
      if (confirmed) mb.confirmed++;
      if (isMissed) mb.missed++;
      if (e.delayMinutes !== null && e.delayMinutes > 0) {
        mb.delaySum += e.delayMinutes;
        mb.delayCount++;
        delaySum += e.delayMinutes;
        delayCount++;
      }
      medMap.set(e.medicationId, mb);

      // Day series (for longest streak).
      const dkey = dateKeyInZone(e.scheduledAt, tz);
      const db_ = dayMap.get(dkey) ?? { total: 0, confirmed: 0, missed: 0 };
      db_.total++;
      if (confirmed) db_.confirmed++;
      if (isMissed) db_.missed++;
      dayMap.set(dkey, db_);

      // Reminder response time: last sent reminder → this confirmation.
      if (confirmed && e.actualAt) {
        const lastSent = lastReminderByDose.get(e.id);
        if (lastSent !== undefined && e.actualAt.getTime() >= lastSent) {
          responseMinutes.push(Math.round((e.actualAt.getTime() - lastSent) / 60000));
        }
      }
    }

    const resolved = statusCounts.taken + statusCounts.delayed + statusCounts.missed + statusCounts.skipped;
    const confirmed = statusCounts.taken + statusCounts.delayed;
    const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : null);

    const daily = [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, ...d }));

    const byMedication = [...medMap.entries()]
      .map(([id, m]) => ({
        id,
        name: m.name,
        total: m.total,
        confirmed: m.confirmed,
        missed: m.missed,
        adherenceRate: pct(m.confirmed, m.total),
        avgDelayMinutes: m.delayCount > 0 ? Math.round(m.delaySum / m.delayCount) : null,
      }))
      .sort((a, b) => b.total - a.total);

    return json({
      // Legacy-compatible shape (the Analytics page charts these directly).
      taken: statusCounts.taken,
      missed: statusCounts.missed,
      delayed: statusCounts.delayed,
      pending: statusCounts.pending,
      skipped: statusCounts.skipped,
      byDay,
      // Analytics 2.0 KPIs (plan Phase 4) — DoseEvent-based, user-timezone.
      windowDays: days,
      timeZone: tz,
      resolved,
      confirmed,
      confirmationRate: pct(confirmed, resolved), // % of resolved doses confirmed
      onTimeRate: pct(statusCounts.taken, confirmed), // % of confirmed doses on time
      unconfirmedRate: pct(statusCounts.delayed + statusCounts.missed, resolved), // ML label basis
      skippedRate: pct(statusCounts.skipped, resolved),
      avgDelayMinutes: delayCount > 0 ? Math.round(delaySum / delayCount) : null,
      currentStreakDays: streakDays,
      longestStreakDays: longestStreakFromDaily(daily),
      byHour: [...hourMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([hour, h]) => ({ hour, ...h })),
      byMedication,
      reminderResponse: {
        samples: responseMinutes.length,
        medianMinutes: median(responseMinutes),
        avgMinutes:
          responseMinutes.length > 0
            ? Math.round(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length)
            : null,
      },
      dataSource: "dose-events",
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Failed to fetch analytics" }, 500);
  }
});
