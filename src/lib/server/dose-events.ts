/**
 * MEDSYNC-003 — DoseEvent materialization, migration and synchronization.
 *
 * The DoseEvent table is the atomic, queryable source of truth for the
 * adherence platform:
 *
 *   Medication → (materialize)  → pending DoseEvents for the scheduling window
 *   adherenceHistory → (migrate) → historical DoseEvents with real outcomes
 *   /api/medicine/status → (sync) → live outcome updates (dual-write — the
 *                                  legacy JSON fields stay untouched so the
 *                                  original UI keeps working unchanged)
 */

import { db } from "@/lib/db";
import { parseJson, type DosageTime, type AdherenceRecord } from "./serialize";
import {
  atTimeInZone,
  dayNameInZone,
  fromWallClock,
  startOfDayInZone,
  getUserTimeZone,
  wallClock,
} from "./tz";

export const DOSE_STATUSES = ["pending", "taken", "delayed", "missed", "skipped"] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

/** A pending dose auto-transitions to "missed" after this window (minutes). */
export const MISSED_AFTER_MINUTES = 120;
/** A confirmed dose later than this is analytically "delayed" (minutes). */
export const DELAYED_AFTER_MINUTES = 30;

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function riskLevelOf(score: number): "low" | "medium" | "high" {
  if (score >= 0.55) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

/**
 * Materializes pending DoseEvents for every active medication whose
 * dosageDays × dosageTimes fall inside [from, to]. Idempotent per
 * (medicationId, scheduledAt) — existing rows are never touched.
 *
 * Phase 3 (timezone): a slot "08:00" means 08:00 in the USER's timezone
 * (`timeZone` param, auto-fetched when omitted); `scheduledAt` stays an
 * absolute UTC instant.
 *
 * Honesty rule (no retroactive fabrication): slots whose grace window fully
 * elapsed BEFORE they were ever materialized are skipped, not back-filled as
 * instant "missed" rows — a dose that was never tracked as upcoming is not
 * recorded as a miss, and a timezone change cannot duplicate a past slot.
 */
export async function materializeDoseEvents(
  userId: string,
  from: Date,
  to: Date,
  timeZone?: string
): Promise<number> {
  const tz = timeZone ?? (await getUserTimeZone(userId));
  const now = Date.now();
  const meds = await db.medication.findMany({ where: { userId } });
  const existing = await db.doseEvent.findMany({
    where: { userId, scheduledAt: { gte: from, lte: to } },
    select: { medicationId: true, scheduledAt: true },
  });
  const seen = new Set(existing.map((e) => `${e.medicationId}@${e.scheduledAt.getTime()}`));

  let created = 0;
  for (const med of meds) {
    const days = parseJson<string[]>(med.dosageDays, []);
    const times = parseJson<DosageTime[]>(med.dosageTimes, []);
    if (days.length === 0 || times.length === 0) continue;

    const hardEnd = med.endDate && med.endDate < to ? med.endDate : to;

    // Walk calendar days in the USER's timezone. The increment is PURE
    // calendar arithmetic on (y, m, d) — routing it through an instant would
    // skip or repeat a day at DST transitions or extreme UTC offsets.
    let wc = wallClock(startOfDayInZone(med.startDate > from ? med.startDate : from, tz), tz);
    for (;;) {
      const dayStart = fromWallClock(wc.year, wc.month, wc.day, 0, 0, tz);
      if (dayStart > hardEnd) break;
      if (days.includes(dayNameInZone(dayStart, tz))) {
        for (const t of times) {
          const scheduledAt = atTimeInZone(dayStart, t.time, tz);
          if (scheduledAt < from || scheduledAt > to) continue;
          if (scheduledAt.getTime() + MISSED_AFTER_MINUTES * 60 * 1000 < now) continue; // grace fully elapsed → never tracked as upcoming
          const key = `${med.id}@${scheduledAt.getTime()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            await db.doseEvent.create({
              data: {
                userId,
                medicationId: med.id,
                scheduledAt,
                slotTime: t.time,
                status: "pending",
                source: "scheduler",
              },
            });
            created++;
          } catch {
            // Unique race (medicationId+scheduledAt) — treat as already scheduled.
          }
        }
      }
      const next = new Date(Date.UTC(wc.year, wc.month - 1, wc.day + 1));
      wc = {
        ...wc,
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
      };
    }
  }
  return created;
}

/** Standard scheduling window: grace window back + 7 days ahead. */
export async function ensureUpcomingDoseEvents(userId: string): Promise<number> {
  const tz = await getUserTimeZone(userId);
  const to = new Date();
  to.setDate(to.getDate() + 7);
  return materializeDoseEvents(
    userId,
    new Date(Date.now() - MISSED_AFTER_MINUTES * 60 * 1000),
    to,
    tz
  );
}

/**
 * MEDSYNC-003 migration — converts each medication's legacy
 * `adherenceHistory` JSON records into DoseEvent rows (source="migration").
 * Migration is ground truth for the past: it fills pending/scheduler rows
 * but never overwrites a manually confirmed outcome.
 */
export async function migrateAdherenceHistory(userId: string): Promise<{
  medications: number;
  records: number;
  events: number;
}> {
  const tz = await getUserTimeZone(userId);
  const meds = await db.medication.findMany({ where: { userId } });
  let records = 0;
  let events = 0;

  for (const med of meds) {
    const history = parseJson<AdherenceRecord[]>(med.adherenceHistory, []);
    for (const rec of history) {
      records++;
      // The legacy record's `date` is the moment the user acted (click time),
      // while `time` is the true scheduled slot — the scheduled moment is the
      // record's day (in the USER's timezone) at its slot time.
      const actedAt = new Date(rec.date);
      if (Number.isNaN(actedAt.getTime())) continue;
      const scheduledAt = atTimeInZone(actedAt, rec.time || "00:00", tz);

      const actualAt = rec.takenAt ? new Date(rec.takenAt) : null;
      const hasActual = actualAt !== null && !Number.isNaN(actualAt.getTime());
      const delayMinutes = hasActual
        ? Math.round((actualAt!.getTime() - scheduledAt.getTime()) / 60000)
        : null;

      // Analytical refinement: a "taken" confirmation far past the slot is an
      // honest "delayed" (kept distinct from on-time "taken").
      const legacyStatus: DoseStatus = (() => {
        if (rec.status === "missed") return "missed";
        if (rec.status === "delayed") return "delayed";
        return delayMinutes !== null && delayMinutes > DELAYED_AFTER_MINUTES ? "delayed" : "taken";
      })();

      const existing = await db.doseEvent.findUnique({
        where: { medicationId_scheduledAt: { medicationId: med.id, scheduledAt } },
      });
      if (existing) {
        // Migration is ground truth for the past: it fills pending rows AND
        // restores scheduler rows that were auto-transitioned to "missed"
        // before the migration ran (boot tick ordering) — never a manually
        // confirmed outcome.
        const restorable =
          existing.status === "pending" ||
          (existing.status === "missed" && existing.source !== "migration" && existing.actualAt === null);
        if (restorable) {
          await db.doseEvent.update({
            where: { id: existing.id },
            data: {
              status: legacyStatus,
              actualAt: hasActual ? actualAt : null,
              delayMinutes,
              source: "migration",
            },
          });
          events++;
        }
        continue;
      }
      await db.doseEvent.create({
        data: {
          userId,
          medicationId: med.id,
          scheduledAt,
          slotTime: rec.time || "00:00",
          status: legacyStatus,
          actualAt: hasActual ? actualAt : null,
          delayMinutes,
          source: "migration",
        },
      });
      events++;
    }
  }
  return { medications: meds.length, records, events };
}

/**
 * Outcome auto-transition: pending doses whose grace window elapsed become
 * "missed". This is the honest "not confirmed" outcome — it never claims the
 * user skipped; it only records that no confirmation arrived in time.
 */
export async function autoTransitionMissed(userId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - MISSED_AFTER_MINUTES * 60 * 1000);
  const result = await db.doseEvent.updateMany({
    where: {
      status: "pending",
      scheduledAt: { lt: cutoff },
      ...(userId ? { userId } : {}),
    },
    data: { status: "missed" },
  });
  return result.count;
}

/**
 * Dual-write sync from the legacy status endpoint: when the original UI marks a
 * dose slot as taken/missed/delayed via /api/medicine/status, mirror the outcome
 * into today's DoseEvent. Legacy JSON fields are untouched.
 *
 * Analytical refinement: a "taken" confirmation more than DELAYED_AFTER_MINUTES
 * after the scheduled time is recorded as "delayed" (truthful for ML), while the
 * legacy fields keep the status exactly as the client sent it.
 */
export async function syncDoseEventFromStatus(params: {
  userId: string;
  medicationId: string;
  slotTime: string;
  status: "taken" | "missed" | "delayed";
  confirmedAt?: Date;
}): Promise<void> {
  const { userId, medicationId, slotTime, status } = params;
  const now = params.confirmedAt ?? new Date();
  const tz = await getUserTimeZone(userId);
  const dayStart = startOfDayInZone(now, tz);
  const scheduledAt = atTimeInZone(now, slotTime, tz);

  const existing = await db.doseEvent.findFirst({
    where: { medicationId, scheduledAt: { gte: dayStart, lte: scheduledAt }, slotTime },
    orderBy: { scheduledAt: "desc" },
  });

  const delayMinutes = status === "missed" ? null : Math.round((now.getTime() - scheduledAt.getTime()) / 60000);
  const effective: DoseStatus =
    status === "taken" && delayMinutes !== null && delayMinutes > DELAYED_AFTER_MINUTES
      ? "delayed"
      : status;

  if (existing) {
    if (existing.status === "pending" || existing.source === "scheduler") {
      await db.doseEvent.update({
        where: { id: existing.id },
        data: {
          status: effective,
          actualAt: status === "missed" ? null : now,
          delayMinutes,
          source: "manual",
        },
      });
    }
    return;
  }
  try {
    await db.doseEvent.create({
      data: {
        userId,
        medicationId,
        scheduledAt,
        slotTime,
        status: effective,
        actualAt: status === "missed" ? null : now,
        delayMinutes,
        source: "manual",
      },
    });
  } catch {
    // Unique race — another writer already created this slot.
  }
}

/** Full pipeline preparation for one user: window materialization + migration. */
export async function prepareUserDoseEvents(userId: string): Promise<{
  materialized: number;
  migrated: { medications: number; records: number; events: number };
}> {
  const materialized = await ensureUpcomingDoseEvents(userId);
  const migrated = await migrateAdherenceHistory(userId);
  await autoTransitionMissed(userId);
  return { materialized, migrated };
}
