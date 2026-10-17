import { db } from "@/lib/db";
import type { DoseStatus, RiskLevel } from "@/lib/types";

/**
 * WP2 preview — heuristic miss-risk per dose.
 * Features mirror the plan: hour, weekday, doses-per-day, current streak,
 * misses in the last 7 days, weekend flag. The trained model replaces this.
 */
export function riskHeuristic(input: {
  hour: number;
  weekday: number; // 0=Sunday
  dosesPerDay: number;
  streak: number;
  missesLast7Days: number;
}): number {
  let risk = 0.08;

  // Evening / night doses are missed more often
  if (input.hour >= 20) risk += 0.18;
  else if (input.hour >= 17) risk += 0.12;
  else if (input.hour < 7) risk += 0.1;

  // Weekend drift
  const isWeekend = input.weekday === 5 || input.weekday === 6;
  if (isWeekend) risk += 0.1;

  // Regimen complexity
  if (input.dosesPerDay >= 3) risk += 0.12;
  else if (input.dosesPerDay === 2) risk += 0.05;

  // Recent behavior dominates
  risk += Math.min(input.missesLast7Days * 0.09, 0.36);

  // A long streak protects
  if (input.streak >= 7) risk -= 0.1;
  else if (input.streak >= 3) risk -= 0.05;

  return Math.max(0.03, Math.min(0.97, Number(risk.toFixed(2))));
}

export function riskLevelOf(risk: number): RiskLevel {
  if (risk >= 0.55) return "high";
  if (risk >= 0.35) return "medium";
  return "low";
}

export function parseTimes(medTimes: string): string[] {
  try {
    const arr = JSON.parse(medTimes);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function parseDays(medDays: string): number[] {
  try {
    const arr = JSON.parse(medDays);
    return Array.isArray(arr) ? (arr as number[]) : [];
  } catch {
    return [];
  }
}

function atTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/**
 * Creates today's pending DoseEvents for every active medication whose
 * schedule matches today's weekday. Idempotent per (medication, time).
 */
export async function ensureTodayDoses(): Promise<void> {
  const meds = await db.medication.findMany({ where: { active: true } });
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekday = todayStart.getDay();

  for (const med of meds) {
    const days = parseDays(med.days);
    if (!days.includes(weekday)) continue;
    for (const time of parseTimes(med.times)) {
      const scheduledAt = atTime(todayStart, time);
      const existing = await db.doseEvent.findFirst({
        where: { medicationId: med.id, scheduledAt: { gte: todayStart, lt: todayEnd } },
      });
      if (!existing) {
        await db.doseEvent.create({
          data: { medicationId: med.id, scheduledAt, status: "pending" },
        });
      }
    }
  }

  // Auto-mark past pending doses as missed (end of day housekeeping)
  await db.doseEvent.updateMany({
    where: { status: "pending", scheduledAt: { lt: new Date(now.getTime() - 90 * 60 * 1000) } },
    data: { status: "missed" },
  });
}

/** Current streak of consecutive days (ending yesterday/today) with zero missed doses. */
export async function computeStreak(): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  since.setHours(0, 0, 0, 0);
  const doses = await db.doseEvent.findMany({
    where: { scheduledAt: { gte: since } },
    select: { scheduledAt: true, status: true },
  });

  const byDay = new Map<string, { missed: boolean }>();
  for (const d of doses) {
    const key = new Date(d.scheduledAt).toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? { missed: false };
    if (d.status === "missed") entry.missed = true;
    byDay.set(key, entry);
  }

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  // Skip today if still in progress (pending doses left)
  const todayKey = cursor.toISOString().slice(0, 10);
  const todayDoses = doses.filter(
    (d) => new Date(d.scheduledAt).toISOString().slice(0, 10) === todayKey
  );
  const todayStillOpen = todayDoses.some((d) => d.status === "pending" || d.status === "snoozed");
  if (todayStillOpen && !byDay.get(todayKey)?.missed) {
    streak += 1; // count today as kept so far
  } else if (byDay.get(todayKey)?.missed) {
    return 0;
  }
  cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 60; i++) {
    const key = cursor.toISOString().slice(0, 10);
    const day = byDay.get(key);
    if (!day) break; // no data for that day — stop counting
    if (day.missed) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export async function missesLast7Days(): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const count = await db.doseEvent.count({
    where: { status: "missed", scheduledAt: { gte: since } },
  });
  return count;
}

export function statusLabelKey(status: DoseStatus): string {
  switch (status) {
    case "taken":
      return "taken";
    case "missed":
      return "missed";
    case "snoozed":
      return "snoozed";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

/** Builds the full TodaySummaryDTO (used by GET /api/doses/today and after PATCH). */
export async function getTodaySummary(): Promise<
  import("@/lib/types").TodaySummaryDTO
> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const doses = await db.doseEvent.findMany({
    where: { scheduledAt: { gte: todayStart, lt: todayEnd } },
    include: { medication: true },
    orderBy: { scheduledAt: "asc" },
  });

  const [streak, misses7] = await Promise.all([computeStreak(), missesLast7Days()]);
  const dosesPerDay = doses.length;
  let overallRisk = 0;

  const doseDTOs: import("@/lib/types").DoseDTO[] = doses.map((d) => {
    const scheduled = new Date(d.scheduledAt);
    const risk =
      d.status === "pending" || d.status === "snoozed"
        ? riskHeuristic({
            hour: scheduled.getHours(),
            weekday: scheduled.getDay(),
            dosesPerDay,
            streak,
            missesLast7Days: misses7,
          })
        : 0;
    overallRisk = Math.max(overallRisk, risk);
    return {
      id: d.id,
      medicationId: d.medicationId,
      medicationName: d.medication.name,
      medicationNameAr: d.medication.nameAr,
      dosage: d.medication.dosage,
      color: d.medication.color,
      scheduledAt: d.scheduledAt.toISOString(),
      status: d.status as DoseStatus,
      respondedAt: d.respondedAt ? d.respondedAt.toISOString() : null,
      risk,
      riskLevel: riskLevelOf(risk),
    };
  });

  const taken = doseDTOs.filter((d) => d.status === "taken").length;
  const total = doseDTOs.length;
  const nextDose =
    doseDTOs.find(
      (d) =>
        (d.status === "pending" || d.status === "snoozed") &&
        new Date(d.scheduledAt) >= new Date(now.getTime() - 30 * 60 * 1000)
    ) ??
    doseDTOs.find((d) => d.status === "pending" || d.status === "snoozed") ??
    null;

  return {
    date: todayStart.toISOString(),
    doses: doseDTOs,
    taken,
    total,
    adherenceRate: total > 0 ? taken / total : 0,
    streak,
    nextDose,
    overallRisk: riskLevelOf(overallRisk),
  };
}
