/**
 * POST /api/streak — port of server/src/api/streakController.js
 * (calculateStreakDays). The controller existed in the original repo but was
 * never mounted in index.js; the client calls /api/streak, so it is wired
 * up here exactly as the controller implements it.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { parseJson, type AdherenceRecord } from "@/lib/server/serialize";
import { withMetrics } from "@/lib/server/metrics";

interface MedWithHistory {
  adherenceHistory: unknown;
  pillName: string;
}

function calculateConsecutiveAdherenceDays(medications: MedWithHistory[]): number {
  const allAdherenceRecords: { date: Date; status: string }[] = [];

  medications.forEach((med) => {
    const history = parseJson<AdherenceRecord[]>(med.adherenceHistory, []);
    history.forEach((record) => {
      allAdherenceRecords.push({ date: new Date(record.date), status: record.status });
    });
  });

  if (allAdherenceRecords.length === 0) return 0;

  const dailyAdherence: Record<string, { total: number; taken: number; missed: number; delayed: number }> = {};
  allAdherenceRecords.forEach((record) => {
    const dateStr = record.date.toISOString().split("T")[0];
    if (!dailyAdherence[dateStr]) {
      dailyAdherence[dateStr] = { total: 0, taken: 0, missed: 0, delayed: 0 };
    }
    dailyAdherence[dateStr].total++;
    if (record.status === "taken") dailyAdherence[dateStr].taken++;
    else if (record.status === "missed") dailyAdherence[dateStr].missed++;
    else if (record.status === "delayed") dailyAdherence[dateStr].delayed++;
  });

  const sortedDates = Object.keys(dailyAdherence).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  if (sortedDates.length === 0) return 0;

  let streakDays = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < sortedDates.length; i++) {
    const dateStr = sortedDates[i];
    const recordDate = new Date(dateStr);
    recordDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((today.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0) continue;
    if (i > 0 && daysDiff > streakDays) break;

    const dayData = dailyAdherence[dateStr];
    const adherenceRate = dayData.total > 0 ? dayData.taken / dayData.total : 0;

    if (adherenceRate >= 0.8) {
      streakDays = daysDiff + 1;
    } else {
      if (daysDiff === 0) streakDays = 0;
      break;
    }
  }

  return streakDays;
}

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{ localuser?: { id?: string } }>(req);
    // Phase 12 — BOLA guard: only the caller's own streak is readable.
    const guard = await requireSelf(req, body?.localuser?.id ?? null);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    const medications = (await db.medication.findMany({
      where: { userId },
    })) as unknown as MedWithHistory[];

    if (medications.length === 0) {
      return json({ success: true, streakDays: 0, message: "No medications found" });
    }

    const streakDays = calculateConsecutiveAdherenceDays(medications);

    return json({
      success: true,
      streakDays,
      message: `Streak calculated successfully: ${streakDays} days`,
    });
  } catch (error) {
    console.error("Error calculating streak:", error);
    return json(
      { success: false, message: "Server error while calculating streak" },
      500
    );
  }
}

export const POST = withMetrics("POST /api/streak", handler_POST);
