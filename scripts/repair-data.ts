/**
 * Data repair — reconciles pre-existing inconsistencies found by
 * scripts/verify-data.ts:
 *
 *   R1. taken/delayed DoseEvents where delayMinutes was clamped to 0 but
 *       actualAt is EARLIER than scheduledAt → set delayMinutes to the true
 *       signed difference (schema documents "actualAt − scheduledAt,
 *       positive = late"; avgDelay7d only sums positive values so ML
 *       features are unaffected).
 *   R2. the one legacy demo row with status "delayed" but no actualAt →
 *       give it a representative 45-minute delay so field logic is sound.
 *   R3. rebuild every Medication.adherenceHistory from its resolved
 *       DoseEvent history (before today) so the legacy analytics mirror and
 *       the DoseEvent source of truth agree 1:1.
 *
 * Run: bun run scripts/repair-data.ts   (then re-run scripts/verify-data.ts)
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function main() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // ── R0: delete orphan RiskPredictions (doseEvent no longer exists —
  //    left behind by past re-materialization/purge cycles) ────────────────
  const doseIds = new Set((await db.doseEvent.findMany({ select: { id: true } })).map((d) => d.id));
  const allPreds = await db.riskPrediction.findMany({ select: { id: true, doseEventId: true } });
  const orphanIds = allPreds.filter((p) => !doseIds.has(p.doseEventId)).map((p) => p.id);
  for (let i = 0; i < orphanIds.length; i += 500) {
    await db.riskPrediction.deleteMany({ where: { id: { in: orphanIds.slice(i, i + 500) } } });
  }
  console.log(`R0 orphan RiskPredictions deleted: ${orphanIds.length}`);

  // ── R1 + R2: field-logic repairs ────────────────────────────────────────
  const events = await db.doseEvent.findMany({});
  let fixedDelay = 0;
  let fixedMissingActual = 0;
  for (const e of events) {
    if (e.status !== "taken" && e.status !== "delayed") continue;

    if (!e.actualAt) {
      // R2: delayed without actualAt → representative 45-minute delay
      if (e.status === "delayed") {
        await db.doseEvent.update({
          where: { id: e.id },
          data: { actualAt: new Date(e.scheduledAt.getTime() + 45 * 60000), delayMinutes: 45 },
        });
        fixedMissingActual++;
      }
      continue;
    }

    const diff = Math.round((e.actualAt.getTime() - e.scheduledAt.getTime()) / 60000);
    if (e.delayMinutes === null || Math.abs(e.delayMinutes - diff) > 1) {
      await db.doseEvent.update({ where: { id: e.id }, data: { delayMinutes: diff } });
      fixedDelay++;
    }
  }
  console.log(`R1 delayMinutes corrected: ${fixedDelay}`);
  console.log(`R2 missing actualAt repaired: ${fixedMissingActual}`);

  // ── R3: rebuild adherenceHistory from DoseEvent history ────────────────
  const meds = await db.medication.findMany({});
  let rebuilt = 0;
  for (const m of meds) {
    const hist = events
      .filter((e) => e.medicationId === m.id && e.status !== "pending" && e.scheduledAt < todayStart)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .map((e) => ({
        date: dateKey(e.scheduledAt),
        time: e.slotTime,
        status: e.status as "taken" | "missed" | "delayed" | "skipped",
        takenAt: e.actualAt ? e.actualAt.toISOString() : null,
      }));
    await db.medication.update({ where: { id: m.id }, data: { adherenceHistory: JSON.stringify(hist) } });
    rebuilt++;
  }
  console.log(`R3 adherenceHistory rebuilt for ${rebuilt} medications`);

  console.log("\nRepair complete — re-run scripts/verify-data.ts to confirm.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
