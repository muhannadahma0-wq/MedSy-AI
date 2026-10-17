import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeStreak, riskHeuristic } from "@/lib/dose-service";
import type { InsightsDTO } from "@/lib/types";

const WEEKDAY_KEYS = [0, 1, 2, 3, 4, 5, 6];

export async function GET() {
  const now = new Date();
  const nowStart = new Date(now);
  nowStart.setHours(0, 0, 0, 0);

  const since = new Date(nowStart);
  since.setDate(since.getDate() - 60);

  const doses = await db.doseEvent.findMany({
    where: { scheduledAt: { gte: since } },
    select: { scheduledAt: true, status: true, medicationId: true },
  });

  const totalDoses = doses.length;
  const takenDoses = doses.filter((d) => d.status === "taken");
  const streak = await computeStreak();

  // ---- heatmap: last 56 days ----
  const heatmap: InsightsDTO["heatmap"] = [];
  const byDay = new Map<string, { taken: number; total: number }>();
  for (const d of doses) {
    const key = new Date(d.scheduledAt).toISOString().slice(0, 10);
    const e = byDay.get(key) ?? { taken: 0, total: 0 };
    e.total += 1;
    if (d.status === "taken") e.taken += 1;
    byDay.set(key, e);
  }
  for (let i = 55; i >= 0; i--) {
    const day = new Date(nowStart);
    day.setDate(day.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    const e = byDay.get(key);
    heatmap.push({
      date: key,
      rate: e && e.total > 0 ? e.taken / e.total : 0,
      total: e?.total ?? 0,
    });
  }

  // ---- weekday aggregates (last 8 weeks) ----
  const since8 = new Date(nowStart);
  since8.setDate(since8.getDate() - 56);
  const recent = doses.filter((d) => new Date(d.scheduledAt) >= since8);
  const weekly: InsightsDTO["weekly"] = WEEKDAY_KEYS.map((wd) => {
    const dayDoses = recent.filter((d) => new Date(d.scheduledAt).getDay() === wd);
    return {
      weekday: wd,
      taken: dayDoses.filter((d) => d.status === "taken").length,
      missed: dayDoses.filter((d) => d.status === "missed" || d.status === "skipped").length,
    };
  });

  const dayRates = weekly
    .filter((w) => w.taken + w.missed > 0)
    .map((w) => ({ weekday: w.weekday, rate: w.taken / (w.taken + w.missed) }));
  const bestDay = dayRates.length
    ? dayRates.reduce((a, b) => (b.rate > a.rate ? b : a))
    : null;
  const hardestDay = dayRates.length
    ? dayRates.reduce((a, b) => (b.rate < a.rate ? b : a))
    : null;

  // ---- by hour bucket ----
  const buckets: InsightsDTO["byHourBucket"] = [
    { bucket: "morning", taken: 0, total: 0 },
    { bucket: "afternoon", taken: 0, total: 0 },
    { bucket: "evening", taken: 0, total: 0 },
    { bucket: "night", taken: 0, total: 0 },
  ];
  for (const d of doses) {
    const h = new Date(d.scheduledAt).getHours();
    const idx = h < 12 ? 0 : h < 17 ? 1 : h < 21 ? 2 : 3;
    buckets[idx].total += 1;
    if (d.status === "taken") buckets[idx].taken += 1;
  }

  // ---- this week vs last week ----
  const weekStart = new Date(nowStart);
  weekStart.setDate(weekStart.getDate() - nowStart.getDay());
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const inRange = (d: (typeof doses)[number], from: Date, to: Date) => {
    const t = new Date(d.scheduledAt);
    return t >= from && t < to;
  };
  const thisWeekDoses = doses.filter((d) => inRange(d, weekStart, nowStart));
  const lastWeekDoses = doses.filter((d) => inRange(d, prevWeekStart, weekStart));
  const week = {
    taken: thisWeekDoses.filter((d) => d.status === "taken").length,
    missed: thisWeekDoses.filter((d) => d.status === "missed" || d.status === "skipped").length,
    prevTaken: lastWeekDoses.filter((d) => d.status === "taken").length,
    prevMissed: lastWeekDoses.filter((d) => d.status === "missed" || d.status === "skipped").length,
  };

  // ---- risk forecast (next 7 days, heuristic WP2 preview) ----
  const meds = await db.medication.findMany({ where: { active: true } });
  const medsPerDay = meds.length;
  const misses7 = doses.filter(
    (d) => d.status === "missed" && new Date(d.scheduledAt) >= since8
  ).length;
  const riskForecast: InsightsDTO["riskForecast"] = [];
  for (let i = 1; i <= 7; i++) {
    const day = new Date(nowStart);
    day.setDate(day.getDate() + i);
    const dosesForDay = meds.reduce((acc, m) => {
      try {
        const times = JSON.parse(m.times) as string[];
        const days = JSON.parse(m.days) as number[];
        return acc + (days.includes(day.getDay()) ? times.length : 0);
      } catch {
        return acc;
      }
    }, 0);
    const risk = riskHeuristic({
      hour: 20, // worst-case evening dose
      weekday: day.getDay(),
      dosesPerDay: dosesForDay || medsPerDay,
      streak,
      missesLast7Days: misses7,
    });
    riskForecast.push({ date: day.toISOString().slice(0, 10), risk });
  }

  const payload: InsightsDTO = {
    hasData: totalDoses > 0,
    totalDoses,
    overallAdherence: totalDoses > 0 ? takenDoses.length / totalDoses : 0,
    streak,
    bestDay,
    hardestDay,
    heatmap,
    weekly,
    riskForecast,
    byHourBucket: buckets,
    week,
  };

  return NextResponse.json(payload);
}
