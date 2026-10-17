/**
 * MEDSYNC-005 — Adherence Engine.
 *
 * All adherence analytics are computed from DoseEvent rows (never from the
 * legacy JSON blobs). Terminology follows the research framing:
 *   "confirmed"      = the user recorded the dose (taken or delayed)
 *   "not confirmed"  = missed (no confirmation inside the grace window)
 * A delayed dose is confirmed but late — it is never conflated with missed.
 */

import { db } from "@/lib/db";
import { DAY_NAMES, type DoseStatus } from "./dose-events";
import {
  dateKeyInZone,
  startOfDayInZone,
  wallClock,
  addDaysToKey,
  getUserTimeZone,
} from "./tz";

export interface AdherenceSummary {
  windowDays: number;
  total: number;
  taken: number;
  delayed: number;
  missed: number;
  pending: number;
  skipped: number;
  resolved: number; // taken + delayed + missed + skipped
  confirmed: number; // taken + delayed
  // MASTER AUDIT P1-40 — null ("N/A — insufficient data") when the window has
  // no resolved doses; a 0-dose window is NOT 100% adherence.
  adherenceRate: number | null; // confirmed / resolved ∈ [0,1]
  onTimeRate: number | null; // taken / confirmed ∈ [0,1]
  notConfirmedRate: number | null; // (delayed + missed) / resolved — the ML label basis
  avgDelayMinutes: number | null;
  streakDays: number;
  byWeekday: { day: string; total: number; confirmed: number; missed: number }[];
  bySlot: { slotTime: string; total: number; confirmed: number; missed: number; avgDelay: number | null }[];
  daily: { date: string; total: number; confirmed: number; missed: number }[];
}

/**
 * Consecutive days (ending today, or yesterday if today has no resolved dose
 * yet) with at least one confirmed dose and zero missed doses — day
 * boundaries computed in the USER's timezone (Phase 3).
 */
export async function computeStreakFromDoseEvents(userId: string): Promise<number> {
  const tz = await getUserTimeZone(userId);
  const since = new Date();
  since.setDate(since.getDate() - 400);

  const events = await db.doseEvent.findMany({
    where: { userId, scheduledAt: { gte: since } },
    select: { scheduledAt: true, status: true },
    orderBy: { scheduledAt: "asc" },
  });

  const byDay = new Map<string, { confirmed: number; missed: number }>();
  for (const e of events) {
    const key = dateKeyInZone(e.scheduledAt, tz);
    const bucket = byDay.get(key) ?? { confirmed: 0, missed: 0 };
    if (e.status === "taken" || e.status === "delayed") bucket.confirmed++;
    if (e.status === "missed") bucket.missed++;
    byDay.set(key, bucket);
  }

  let streak = 0;
  // Allow the streak to survive "today not resolved yet".
  // MR-13 central fix (2026-10-01): a TODAY bucket with zero resolved doses
  // (everything still pending) must be SKIPPED, not scanned — previously its
  // mere existence started the scan at a confirmed=0 bucket and broke the
  // streak to 0 every morning until the first dose was confirmed. A today
  // bucket that already has misses still breaks the streak honestly.
  const todayKey = dateKeyInZone(new Date(), tz);
  const todayBucket = byDay.get(todayKey);
  const todayAllPending =
    todayBucket !== undefined && todayBucket.confirmed === 0 && todayBucket.missed === 0;
  let cursor =
    todayBucket && !todayAllPending ? todayKey : addDaysToKey(todayKey, -1);

  for (;;) {
    const bucket = byDay.get(cursor);
    if (bucket && bucket.confirmed > 0 && bucket.missed === 0) {
      streak++;
      cursor = addDaysToKey(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

/** Longest run of fully-adherent days in the window (Phase 4 KPI). */
export function longestStreakFromDaily(
  daily: { date: string; total: number; confirmed: number; missed: number }[]
): number {
  let best = 0;
  let run = 0;
  for (const d of daily) {
    if (d.confirmed > 0 && d.missed === 0) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export async function getAdherenceSummary(userId: string, windowDays = 30): Promise<AdherenceSummary> {
  const tz = await getUserTimeZone(userId);
  const from = new Date();
  from.setDate(from.getDate() - (windowDays - 1));
  const fromDay = startOfDayInZone(from, tz);

  const [events, streakDays] = await Promise.all([
    db.doseEvent.findMany({
      where: { userId, scheduledAt: { gte: fromDay } },
      orderBy: { scheduledAt: "asc" },
    }),
    computeStreakFromDoseEvents(userId),
  ]);

  const weekday = DAY_NAMES.map((day) => ({ day, total: 0, confirmed: 0, missed: 0 }));
  const slotMap = new Map<string, { total: number; confirmed: number; missed: number; delaySum: number; delayCount: number }>();
  const dayMap = new Map<string, { total: number; confirmed: number; missed: number }>();

  let taken = 0,
    delayed = 0,
    missed = 0,
    pending = 0,
    skipped = 0,
    delaySum = 0,
    delayCount = 0;

  for (const e of events) {
    const status = e.status as DoseStatus;
    if (status === "taken") taken++;
    else if (status === "delayed") delayed++;
    else if (status === "missed") missed++;
    else if (status === "skipped") skipped++;
    else pending++;

    const confirmed = status === "taken" || status === "delayed";
    const isMissed = status === "missed";

    const dayLabel = wallClock(e.scheduledAt, tz).weekday;
    const wdIndex = DAY_NAMES.indexOf(dayLabel as (typeof DAY_NAMES)[number]);
    const wd = wdIndex >= 0 ? weekday[wdIndex] : undefined;
    if (wd) {
      wd.total++;
      if (confirmed) wd.confirmed++;
      if (isMissed) wd.missed++;
    }

    const slot = slotMap.get(e.slotTime) ?? { total: 0, confirmed: 0, missed: 0, delaySum: 0, delayCount: 0 };
    slot.total++;
    if (confirmed) slot.confirmed++;
    if (isMissed) slot.missed++;
    if (e.delayMinutes !== null && e.delayMinutes > 0) {
      slot.delaySum += e.delayMinutes;
      slot.delayCount++;
      delaySum += e.delayMinutes;
      delayCount++;
    }
    slotMap.set(e.slotTime, slot);

    const dkey = dateKeyInZone(e.scheduledAt, tz);
    const db_ = dayMap.get(dkey) ?? { total: 0, confirmed: 0, missed: 0 };
    db_.total++;
    if (confirmed) db_.confirmed++;
    if (isMissed) db_.missed++;
    dayMap.set(dkey, db_);
  }

  const total = events.length;
  const resolved = taken + delayed + missed + skipped;
  const confirmed = taken + delayed;

  return {
    windowDays,
    total,
    taken,
    delayed,
    missed,
    pending,
    skipped,
    resolved,
    confirmed,
    // P1-40 — no resolved doses → N/A (null), never a fake 100%.
    adherenceRate: resolved > 0 ? Number((confirmed / resolved).toFixed(4)) : null,
    onTimeRate: confirmed > 0 ? Number((taken / confirmed).toFixed(4)) : null,
    notConfirmedRate: resolved > 0 ? Number(((delayed + missed) / resolved).toFixed(4)) : null,
    avgDelayMinutes: delayCount > 0 ? Math.round(delaySum / delayCount) : null,
    streakDays,
    byWeekday: weekday,
    bySlot: [...slotMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([slotTime, s]) => ({
        slotTime,
        total: s.total,
        confirmed: s.confirmed,
        missed: s.missed,
        avgDelay: s.delayCount > 0 ? Math.round(s.delaySum / s.delayCount) : null,
      })),
    daily: [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, total: d.total, confirmed: d.confirmed, missed: d.missed })),
  };
}
