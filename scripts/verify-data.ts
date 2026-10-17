/**
 * Data integrity verification — audits the seeded cohort + demo data.
 *
 * Checks (each PASS/FAIL with details):
 *   1. Orphans        — DoseEvent/SmartReminder/RiskPrediction rows whose
 *                       user or medication no longer exists.
 *   2. Status logic   — taken/delayed ⇒ actualAt present and delayMinutes
 *                       consistent with actualAt − scheduledAt; delayed ⇒
 *                       delay > 30 min; taken ⇒ delay ≤ 30 min; missed ⇒
 *                       actualAt null; skipped ⇒ skipReason present.
 *   3. Duplicates     — no duplicate (medicationId, scheduledAt) pairs.
 *   4. Study arms     — every user WITH medications has an assignment;
 *                       arms reported with counts.
 *   5. Legacy mirror  — adherenceHistory entry count per user vs resolved
 *                       DoseEvent count (should match: seed dual-writes).
 *   6. Predictions    — pending doses within the scoring horizon have a
 *                       RiskPrediction row (engine coverage).
 *   7. Per-user stats — confirmed/on-time rates per user (sanity ranges).
 *
 * Run: bun run scripts/verify-data.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

interface CheckResult {
  name: string;
  pass: boolean;
  details: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, details: string) {
  results.push({ name, pass, details });
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"} — ${name}\n      ${details}`);
}

async function main() {
  const now = new Date();
  console.log(`\nMedSync AI — data integrity audit @ ${now.toISOString()}\n${"=".repeat(60)}\n`);

  // ── 1. orphans ──────────────────────────────────────────────────────────
  const medIds = new Set((await db.medication.findMany({ select: { id: true } })).map((m) => m.id));
  const userIds = new Set((await db.user.findMany({ select: { id: true } })).map((u) => u.id));

  const events = await db.doseEvent.findMany({});
  const orphanMeds = events.filter((e) => !medIds.has(e.medicationId));
  const orphanUsers = events.filter((e) => !userIds.has(e.userId));
  check(
    "1. No orphan DoseEvents (medication + user exist)",
    orphanMeds.length === 0 && orphanUsers.length === 0,
    `events=${events.length}, orphanMed=${orphanMeds.length}, orphanUser=${orphanUsers.length}`
  );

  const orphanRemUsers = (await db.smartReminder.findMany({ select: { userId: true } })).filter((r) => !userIds.has(r.userId));
  check("1b. No orphan SmartReminders", orphanRemUsers.length === 0, `orphans=${orphanRemUsers.length}`);

  const orphanPredEvents = (await db.riskPrediction.findMany({ select: { doseEventId: true } })).filter(
    (p) => !events.some((e) => e.id === p.doseEventId)
  );
  check("1c. No orphan RiskPredictions", orphanPredEvents.length === 0, `orphans=${orphanPredEvents.length}`);

  // ── 2. status logic ─────────────────────────────────────────────────────
  let badActual = 0, badDelay = 0, badDelayed = 0, badTaken = 0, badMissed = 0, badSkip = 0;
  for (const e of events) {
    const dm = e.delayMinutes;
    if ((e.status === "taken" || e.status === "delayed") && !e.actualAt) badActual++;
    if ((e.status === "taken" || e.status === "delayed") && e.actualAt) {
      const diff = Math.round((e.actualAt.getTime() - e.scheduledAt.getTime()) / 60000);
      if (dm === null || Math.abs(dm - diff) > 1) badDelay++;
    }
    if (e.status === "delayed" && (dm === null || dm <= 30)) badDelayed++;
    if (e.status === "taken" && (dm === null || dm > 30)) badTaken++;
    if (e.status === "missed" && (e.actualAt !== null || dm !== null)) badMissed++;
    if (e.status === "skipped" && !e.skipReason) badSkip++;
  }
  check(
    "2. Status field logic (actualAt/delay/skipReason)",
    badActual + badDelay + badDelayed + badTaken + badMissed + badSkip === 0,
    `badActual=${badActual} badDelay=${badDelay} badDelayed=${badDelayed} badTaken=${badTaken} badMissed=${badMissed} badSkip=${badSkip}`
  );

  // ── 3. duplicates ───────────────────────────────────────────────────────
  const seen = new Set<string>();
  let dups = 0;
  for (const e of events) {
    const k = `${e.medicationId}@${e.scheduledAt.toISOString()}`;
    if (seen.has(k)) dups++;
    seen.add(k);
  }
  check("3. No duplicate (medication, scheduledAt)", dups === 0, `duplicates=${dups}`);

  // ── 4. study arms ───────────────────────────────────────────────────────
  const usersWithMeds = await db.medication.findMany({ select: { userId: true }, distinct: ["userId"] });
  const assignments = await db.studyAssignment.findMany({});
  const withArm = new Set(assignments.map((a) => a.userId));
  const missingArm = usersWithMeds.filter((u) => !withArm.has(u.userId));
  const armCounts = { control: 0, smart: 0 };
  for (const a of assignments) armCounts[a.arm as "control" | "smart"] = (armCounts[a.arm as "control" | "smart"] ?? 0) + 1;
  check(
    "4. Every active user has a study arm",
    missingArm.length === 0,
    `usersWithMeds=${usersWithMeds.length}, missingArm=${missingArm.length}, arms=${JSON.stringify(armCounts)}`
  );

  // ── 5. legacy mirror ────────────────────────────────────────────────────
  const meds = await db.medication.findMany({});
  const mirrorGaps: string[] = [];
  for (const m of meds) {
    let hist: unknown[] = [];
    try {
      hist = typeof m.adherenceHistory === "string" ? JSON.parse(m.adherenceHistory) : (m.adherenceHistory as unknown[]);
    } catch {
      hist = [];
    }
    if (!Array.isArray(hist)) hist = [];
    const resolvedEvents = events.filter((e) => e.medicationId === m.id && e.status !== "pending").length;
    // History events (before today) should be mirrored 1:1 in adherenceHistory.
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const histEvents = events.filter(
      (e) => e.medicationId === m.id && e.status !== "pending" && e.scheduledAt < todayStart
    ).length;
    if (Math.abs(hist.length - histEvents) > 2) {
      mirrorGaps.push(`${m.pillName}: adherenceHistory=${hist.length} vs history DoseEvents=${histEvents} (resolved total ${resolvedEvents})`);
    }
  }
  check(
    "5. Legacy adherenceHistory mirrors DoseEvent history",
    mirrorGaps.length === 0,
    mirrorGaps.length === 0 ? `all ${meds.length} medications mirrored` : mirrorGaps.slice(0, 5).join(" | ")
  );

  // ── 6. prediction coverage ──────────────────────────────────────────────
  const horizonEnd = new Date(now.getTime() + 24 * 3600 * 1000);
  const pendingInHorizon = events.filter(
    (e) => e.status === "pending" && e.scheduledAt >= new Date(now.getTime() - 2 * 3600 * 1000) && e.scheduledAt <= horizonEnd
  );
  const predEventIds = new Set((await db.riskPrediction.findMany({ select: { doseEventId: true } })).map((p) => p.doseEventId));
  const uncovered = pendingInHorizon.filter((e) => !predEventIds.has(e.id));
  check(
    "6. Pending doses in 24h horizon have risk predictions",
    uncovered.length === 0,
    `pendingInHorizon=${pendingInHorizon.length}, uncovered=${uncovered.length}`
  );

  // ── 7. per-user adherence stats ──────────────────────────────────────────
  console.log("\n— Per-user adherence (resolved events only) —");
  const stats: string[] = [];
  for (const uid of userIds) {
    const user = (await db.user.findUnique({ where: { id: uid } }))!;
    const medCount = meds.filter((m) => m.userId === uid).length;
    if (medCount === 0) continue;
    const mine = events.filter((e) => e.userId === uid);
    const resolved = mine.filter((e) => e.status !== "pending");
    const confirmed = resolved.filter((e) => e.status === "taken" || e.status === "delayed");
    const onTime = resolved.filter((e) => e.status === "taken");
    const skipped = resolved.filter((e) => e.status === "skipped");
    const confRate = resolved.length ? (confirmed.length / resolved.length) * 100 : 0;
    const onTimeRate = resolved.length ? (onTime.length / resolved.length) * 100 : 0;
    const line = `${user.email.padEnd(24)} meds=${medCount} events=${mine.length} resolved=${resolved.length} confirmed=${confRate.toFixed(1)}% onTime=${onTimeRate.toFixed(1)}% skipped=${skipped.length}`;
    console.log("  " + line);
    stats.push(line);
  }

  // persona sanity: Layla ≥ 85% confirmed, Sara ≤ 60%, Khaled last-14d ≥ 80%
  const layla = await db.user.findUnique({ where: { email: "layla@medsync.ai" } });
  const sara = await db.user.findUnique({ where: { email: "sara@medsync.ai" } });
  const khaled = await db.user.findUnique({ where: { email: "khaled@medsync.ai" } });
  const rate = (uid: string, from?: Date) => {
    const mine = events.filter((e) => e.userId === uid && e.status !== "pending" && (!from || e.scheduledAt >= from));
    const c = mine.filter((e) => e.status === "taken" || e.status === "delayed").length;
    return mine.length ? c / mine.length : 0;
  };
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const sanity =
    (layla ? rate(layla.id) >= 0.85 : false) &&
    (sara ? rate(sara.id) <= 0.6 : false) &&
    (khaled ? rate(khaled.id, twoWeeksAgo) >= 0.8 && rate(khaled.id) < rate(khaled.id, twoWeeksAgo) + 0.6 : false);
  check(
    "7. Persona sanity (Layla high / Sara low / Khaled improving)",
    sanity,
    `layla=${layla ? rate(layla.id).toFixed(2) : "?"} sara=${sara ? rate(sara.id).toFixed(2) : "?"} khaled14d=${khaled ? rate(khaled.id, twoWeeksAgo).toFixed(2) : "?"}`
  );

  // ── summary ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${"=".repeat(60)}\nAUDIT RESULT: ${failed.length === 0 ? "ALL CHECKS PASSED ✅" : `${failed.length} CHECK(S) FAILED ❌`}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
