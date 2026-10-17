/**
 * MEDSYNC Phase 3 (master plan §8 item 3) — Timezone correctness.
 *
 * Before this module, every wall-clock decision on the server (which day a
 * slot belongs to, when "today" starts, what weekday it is, what time to show
 * in a reminder message) used the SERVER's local timezone — which happens to
 * be UTC in this deployment. A user in Asia/Hebron would have an "08:00" slot
 * fire at 11:00 their time.
 *
 * Contract (matching the plan):
 *   - `scheduledAt` stays an absolute UTC instant in the database.
 *   - A slot time ("08:00") means 08:00 in the USER's timezone
 *     (`User.timeZone`, IANA name, default "UTC").
 *   - All day-boundary logic (streaks, "today", weekday buckets) is computed
 *     in the user's timezone.
 *
 * Every helper here is pure (no DB); `getUserTimeZone` is the single DB touch.
 */

import { db } from "@/lib/db";

export const DEFAULT_TIME_ZONE = "UTC";

/** Validates an IANA timezone name; returns it, or null when invalid. */
export function normalizeTimeZone(tz: string | null | undefined): string | null {
  if (!tz || typeof tz !== "string") return null;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return null;
  try {
    // RangeError on unknown zone names — the only reliable cross-runtime check.
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

/** The user's validated timezone (DB row → IANA name → "UTC" fallback). */
export async function getUserTimeZone(userId: string): Promise<string> {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
    return normalizeTimeZone(u?.timeZone) ?? DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  weekday: string; // "Sunday".."Saturday" (en-US long)
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24, // ICU can emit "24" at midnight with hour12:false
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** Offset (ms) of `timeZone` at `instant` — positive = ahead of UTC. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const wc = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0);
  const instantFloorSec = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - instantFloorSec;
}

/**
 * The UTC instant of a wall-clock time in `timeZone` (DST-resolved with a
 * two-pass offset refinement). Ambiguous/nonexistent wall times (DST
 * transitions) resolve deterministically to the second pass's answer.
 */
export function fromWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = tzOffsetMs(new Date(naive), timeZone);
  let result = new Date(naive - offset);
  offset = tzOffsetMs(result, timeZone);
  result = new Date(naive - offset);
  return result;
}

/** The UTC instant of `hhmm` ("08:30") on the calendar day of `base` in `timeZone`. */
export function atTimeInZone(base: Date, hhmm: string, timeZone: string): Date {
  const wc = wallClock(base, timeZone);
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return fromWallClock(
    wc.year,
    wc.month,
    wc.day,
    Number.isFinite(h) ? h : 0,
    Number.isFinite(m) ? m : 0,
    timeZone
  );
}

/** The UTC instant of local midnight of `base`'s calendar day in `timeZone`. */
export function startOfDayInZone(base: Date, timeZone: string): Date {
  const wc = wallClock(base, timeZone);
  return fromWallClock(wc.year, wc.month, wc.day, 0, 0, timeZone);
}

/** "Monday".."Sunday" of `instant` as seen in `timeZone`. */
export function dayNameInZone(instant: Date, timeZone: string): string {
  return wallClock(instant, timeZone).weekday;
}

/** "YYYY-MM-DD" of `instant` as seen in `timeZone` (en-CA gives ISO dates). */
export function dateKeyInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** "8:00 AM" style display time of `instant` in `timeZone`. */
export function timeStringInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

/** Shifts a "YYYY-MM-DD" key by `delta` days (pure calendar arithmetic, no TZ). */
export function addDaysToKey(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta));
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

/** Hour-of-day bucket "HH" (00..23) of `instant` in `timeZone`. */
export function hourKeyInZone(instant: Date, timeZone: string): string {
  return String(wallClock(instant, timeZone).hour).padStart(2, "0");
}
