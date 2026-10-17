/**
 * MEDSYNC-007 — Feature extraction for dose-level risk prediction.
 *
 * Every feature is computed strictly from events BEFORE the dose's scheduled
 * time (no leakage). Features are shared by training (labels from resolved
 * outcomes) and live prediction (pending doses).
 */

import { db } from "@/lib/db";
import { parseJson, type DosageTime } from "../serialize";

export const FEATURE_NAMES = [
  "hour",
  "isEvening",
  "isWeekend",
  "dosesPerDay",
  "medicationCount",
  "adherenceRate7d",
  "missedLast7d",
  "streak",
  "avgDelay7d",
  "slotMissStreak",
  "medAgeDays",
  "dosesTodaySoFar",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

/** Bilingual human labels used by the explainability layer (EN / AR-MSA). */
export const FEATURE_LABELS: Record<FeatureName, { en: string; ar: string }> = {
  hour: { en: "Time of day", ar: "وقت الجرعة" },
  isEvening: { en: "Evening dose", ar: "جرعة مسائية" },
  isWeekend: { en: "Weekend", ar: "نهاية الأسبوع" },
  dosesPerDay: { en: "Doses per day (regimen)", ar: "عدد الجرعات اليومية" },
  medicationCount: { en: "Number of medications", ar: "عدد الأدوية" },
  adherenceRate7d: { en: "7-day adherence rate", ar: "الالتزام خلال 7 أيام" },
  missedLast7d: { en: "Missed doses (last 7 days)", ar: "جرعات فائتة (آخر 7 أيام)" },
  streak: { en: "Current streak (days)", ar: "سلسلة الالتزام الحالية" },
  avgDelay7d: { en: "Average delay (last 7 days)", ar: "متوسط التأخير (آخر 7 أيام)" },
  slotMissStreak: { en: "Consecutive misses at this time slot", ar: "فوات متتالية في هذا الموعد" },
  medAgeDays: { en: "Days on this medication", ar: "أيام على هذا الدواء" },
  dosesTodaySoFar: { en: "Doses already due today", ar: "جرعات حلّت اليوم" },
};

export interface FeatureContext {
  userId: string;
  medicationId: string;
  scheduledAt: Date;
  slotTime: string;
}

/**
 * Builds the feature vector for one dose. `history` must contain the user's
 * DoseEvents strictly before `scheduledAt` (any order; filtered internally).
 */
export function buildFeatures(
  ctx: FeatureContext,
  history: { scheduledAt: Date; status: string; slotTime: string; medicationId: string; delayMinutes: number | null }[],
  medInfo: { startDate: Date; dosageTimes: unknown },
  userMedCount: number
): FeatureVector {
  const { scheduledAt, slotTime, medicationId } = ctx;
  const hour = scheduledAt.getHours();
  const weekday = scheduledAt.getDay();

  // ── prior 7-day window ──────────────────────────────────────────────────
  const weekAgo = new Date(scheduledAt.getTime() - 7 * 24 * 3600 * 1000);
  let resolved7 = 0,
    confirmed7 = 0,
    missed7 = 0,
    delaySum = 0,
    delayCount = 0;
  for (const e of history) {
    if (e.scheduledAt >= scheduledAt || e.scheduledAt < weekAgo) continue;
    if (e.status === "pending" || e.status === "skipped") continue;
    resolved7++;
    if (e.status === "taken" || e.status === "delayed") confirmed7++;
    if (e.status === "missed") missed7++;
    if (e.delayMinutes !== null && e.delayMinutes > 0) {
      delaySum += e.delayMinutes;
      delayCount++;
    }
  }

  // ── streak: consecutive fully-confirmed days ending before this dose ─────
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const byDay = new Map<string, { confirmed: number; missed: number }>();
  for (const e of history) {
    if (e.scheduledAt >= scheduledAt) continue;
    if (e.status === "pending" || e.status === "skipped") continue;
    const k = dayKey(e.scheduledAt);
    const b = byDay.get(k) ?? { confirmed: 0, missed: 0 };
    if (e.status === "taken" || e.status === "delayed") b.confirmed++;
    if (e.status === "missed") b.missed++;
    byDay.set(k, b);
  }
  let streak = 0;
  const cursor = new Date(scheduledAt);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1);
  while (streak < 365) {
    const b = byDay.get(dayKey(cursor));
    if (b && b.confirmed > 0 && b.missed === 0) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }

  // ── consecutive misses at the same slot for this medication ──────────────
  const slotHistory = history
    .filter((e) => e.medicationId === medicationId && e.slotTime === slotTime && e.scheduledAt < scheduledAt)
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  let slotMissStreak = 0;
  for (const e of slotHistory) {
    if (e.status === "missed") slotMissStreak++;
    else break;
  }

  // ── regimen + load ───────────────────────────────────────────────────────
  const times = parseJson<DosageTime[]>(medInfo.dosageTimes, []);
  const dosesPerDay = Math.max(1, times.length);
  const medAgeDays = Math.max(
    0,
    Math.round((scheduledAt.getTime() - new Date(medInfo.startDate).getTime()) / (24 * 3600 * 1000))
  );
  const dayStart = new Date(scheduledAt);
  dayStart.setHours(0, 0, 0, 0);
  const dosesTodaySoFar = history.filter(
    (e) => e.scheduledAt >= dayStart && e.scheduledAt < scheduledAt
  ).length;

  return {
    hour,
    isEvening: hour >= 18 ? 1 : 0,
    isWeekend: weekday === 5 || weekday === 6 ? 1 : 0,
    dosesPerDay,
    medicationCount: Math.max(1, userMedCount),
    adherenceRate7d: resolved7 > 0 ? Number((confirmed7 / resolved7).toFixed(4)) : 0.9,
    missedLast7d: missed7,
    streak,
    avgDelay7d: delayCount > 0 ? Math.round(delaySum / delayCount) : 0,
    slotMissStreak,
    medAgeDays,
    dosesTodaySoFar,
  };
}

/**
 * Builds the full per-dose dataset for one user: event + features + label
 * (label only for resolved outcomes; pending → null).
 */
export async function buildUserDataset(userId: string): Promise<
  {
    doseEventId: string;
    scheduledAt: Date;
    slotTime: string;
    medicationId: string;
    features: FeatureVector;
    label: 0 | 1 | null; // 1 = delayed|missed ("not confirmed on time")
  }[]
> {
  const meds = await db.medication.findMany({ where: { userId } });
  const medById = new Map(meds.map((m) => [m.id, m]));
  const events = await db.doseEvent.findMany({
    where: { userId },
    orderBy: { scheduledAt: "asc" },
  });

  const out: {
    doseEventId: string;
    scheduledAt: Date;
    slotTime: string;
    medicationId: string;
    features: FeatureVector;
    label: 0 | 1 | null;
  }[] = [];

  const historyAccum: {
    scheduledAt: Date;
    status: string;
    slotTime: string;
    medicationId: string;
    delayMinutes: number | null;
  }[] = [];

  for (const e of events) {
    const med = medById.get(e.medicationId);
    if (med) {
      const features = buildFeatures(
        { userId, medicationId: e.medicationId, scheduledAt: e.scheduledAt, slotTime: e.slotTime },
        historyAccum,
        { startDate: med.startDate, dosageTimes: med.dosageTimes },
        meds.length
      );
      const label: 0 | 1 | null =
        e.status === "taken" ? 0 : e.status === "delayed" || e.status === "missed" ? 1 : null;
      out.push({
        doseEventId: e.id,
        scheduledAt: e.scheduledAt,
        slotTime: e.slotTime,
        medicationId: e.medicationId,
        features,
        label,
      });
    }
    historyAccum.push({
      scheduledAt: e.scheduledAt,
      status: e.status,
      slotTime: e.slotTime,
      medicationId: e.medicationId,
      delayMinutes: e.delayMinutes,
    });
  }
  return out;
}
