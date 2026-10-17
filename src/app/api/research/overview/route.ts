/**
 * GET /api/research/overview — de-identified study/research dashboard
 * (v5 review item 43 — supervisor view).
 *
 * Aggregates over ALL users (not just the caller), computed with
 * groupBy/count queries where possible. DE-IDENTIFICATION RED-LINE: the
 * response contains NO user ids, NO names, NO emails and NO message/answer
 * content — counts, rates, versions and agent keys only. The export-grade
 * per-participant data stays behind /api/study/export (pseudonymized +
 * consent-gated).
 *
 * Auth: requireSelf — any authenticated account may read the aggregates
 * (graduation-project supervisor view; every participant is de-identified).
 *
 * Sections:
 *   participants  — assignment + consent counts, per assigned arm and per
 *                   EFFECTIVE arm (consent-gated: no active consent → control)
 *   doses         — DoseEvent volume + status mix + confirmation rate (30d)
 *   risk          — active model, prediction volume, high-risk share and
 *                   score-bucket histogram (30d)
 *   dataQuality   — v5 item 44: pre-ML data-quality checks (all-time):
 *                   missing timestamps, duplicate taken doses, invalid risk
 *                   scores, unknown model versions, timezone note, users
 *                   with dose data but no study arm
 *   ai            — per-agent request/safety/latency aggregates + the
 *                   👍/👎/⚠️ feedback mix (30d)
 */
import { db } from "@/lib/db";
import { json, apiError } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { round4 } from "@/lib/server/study-stats";

const WINDOW_MS = 30 * 24 * 3600 * 1000;

/** Percent 0–100 with one decimal (same convention as /api/ai-monitoring). */
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

/** The agents that can receive feedback (AiFeedback.agent closed set). */
const FEEDBACK_AGENTS = ["medical", "medicine", "personal-health", "emergency", "router"] as const;

export const GET = withMetrics("GET /api/research/overview", async (req: Request) => {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const since = new Date(Date.now() - WINDOW_MS);

  try {
    // ── Participants (assignments + consents, read-only) ───────────────────
    const [assignments, consents] = await Promise.all([
      db.studyAssignment.findMany({ select: { userId: true, arm: true } }),
      db.studyConsent.findMany({
        select: { userId: true, version: true, grantedAt: true, revokedAt: true },
      }),
    ]);

    const activeConsentUsers = new Set(
      consents.filter((c) => !c.revokedAt).map((c) => c.userId)
    );
    const participantIds = new Set<string>([
      ...assignments.map((a) => a.userId),
      ...consents.map((c) => c.userId),
    ]);

    // Assigned arms (StudyAssignment as stored) and EFFECTIVE arms
    // (consent-gated — a non-consented participant behaves as control).
    const byArm = { control: 0, smart: 0 };
    const effectiveByArm = { control: 0, smart: 0 };
    for (const a of assignments) {
      if (a.arm !== "control" && a.arm !== "smart") continue;
      byArm[a.arm]++;
      if (activeConsentUsers.has(a.userId)) effectiveByArm[a.arm]++;
    }
    const consentVersions = [
      ...new Set(consents.filter((c) => !c.revokedAt).map((c) => c.version)),
    ].sort();

    // ── Doses (last 30 days, by scheduled time) ─────────────────────────────
    const doseGroups = await db.doseEvent.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { scheduledAt: { gte: since } },
    });
    const byStatus: Record<string, number> = {};
    let doseTotal = 0;
    for (const g of doseGroups) {
      byStatus[g.status] = g._count._all;
      doseTotal += g._count._all;
    }
    // confirmationRate = taken / (taken + missed + skipped) — null when the
    // window has no final outcomes (zero-dose window, never a fake 0/100%).
    const taken = byStatus["taken"] ?? 0;
    const missed = byStatus["missed"] ?? 0;
    const skipped = byStatus["skipped"] ?? 0;
    const confirmationDenominator = taken + missed + skipped;
    const confirmationRate =
      confirmationDenominator > 0 ? round4(taken / confirmationDenominator) : null;

    // ── Risk (active model + last-30d predictions) ──────────────────────────
    const [activeArtifact, recentPredictionRows] = await Promise.all([
      db.modelArtifact.findFirst({
        where: { isActive: true },
        orderBy: { trainedAt: "desc" },
        select: { modelType: true, version: true, trainedAt: true },
      }),
      db.riskPrediction.findMany({
        where: { createdAt: { gte: since } },
        select: { riskScore: true, riskLevel: true },
      }),
    ]);
    const predictionsLast30d = recentPredictionRows.length;
    // RiskPrediction has no boolean highRisk field — riskLevel === "high"
    // is the high-risk marker (schema comment + adherence-engine contract).
    const highRiskCount = recentPredictionRows.filter((p) => p.riskLevel === "high").length;
    const highRiskShare = predictionsLast30d > 0 ? round4(highRiskCount / predictionsLast30d) : null;
    // Score histogram over [0,1] in 0.2-wide buckets (clamped at the edges).
    const bucketCounts = [0, 0, 0, 0, 0];
    for (const p of recentPredictionRows) {
      const clamped = Math.min(0.999999, Math.max(0, p.riskScore));
      bucketCounts[Math.floor(clamped * 5)]++;
    }

    // ── Data quality (v5 item 44 — pre-ML checks, all-time) ────────────────
    const [
      missingTimestampRows,
      duplicateDoseRows,
      invalidRiskScores,
      nullRiskScores,
      predictionVersionGroups,
      allArtifactVersions,
      doseUserGroups,
    ] = await Promise.all([
      // scheduledAt is NOT NULL by schema — the raw check is still honest:
      // it also catches rows that entered SQLite outside the ORM.
      db.$queryRaw<Array<{ n: number | bigint }>>`SELECT COUNT(*) AS n FROM DoseEvent WHERE scheduledAt IS NULL`,
      // Same user + medication + scheduled slot confirmed "taken" more than
      // once → distinct offending groups (the unique [medicationId,
      // scheduledAt] index makes this 0 by construction; checked anyway).
      db.$queryRaw<Array<{ n: number | bigint }>>`SELECT COUNT(*) AS n FROM (
           SELECT userId, medicationId, scheduledAt
           FROM DoseEvent
           WHERE status = 'taken'
           GROUP BY userId, medicationId, scheduledAt
           HAVING COUNT(*) > 1
         )`,
      // riskScore is NOT NULL by schema — only the out-of-range case is
      // possible through the ORM (null scores are checked in raw SQL).
      db.riskPrediction.count({
        where: { OR: [{ riskScore: { lt: 0 } }, { riskScore: { gt: 1 } }] },
      }),
      db.$queryRaw<Array<{ n: number | bigint }>>`SELECT COUNT(*) AS n FROM RiskPrediction WHERE riskScore IS NULL`,
      db.riskPrediction.groupBy({ by: ["modelVersion"], _count: { _all: true } }),
      db.modelArtifact.findMany({ select: { version: true } }),
      db.doseEvent.groupBy({ by: ["userId"], _count: { _all: true } }),
    ]);

    const knownVersions = new Set(allArtifactVersions.map((a) => a.version));
    let unknownModelVersion = 0;
    for (const g of predictionVersionGroups) {
      if (!knownVersions.has(g.modelVersion)) unknownModelVersion += g._count._all;
    }
    const assignedUserIds = new Set(assignments.map((a) => a.userId));
    const missingArm = doseUserGroups.filter((g) => !g.userId || !assignedUserIds.has(g.userId)).length;

    const dataQuality = {
      missingTimestamps: Number(missingTimestampRows[0]?.n ?? 0),
      duplicateDoses: Number(duplicateDoseRows[0]?.n ?? 0),
      invalidRiskScores: invalidRiskScores + Number(nullRiskScores[0]?.n ?? 0),
      unknownModelVersion,
      // Per-user timezone validation (detection window vs stored tz) runs in
      // the reminder engine at scheduling time — not inventable here.
      timezoneMismatch: 0,
      timezoneNote: "Validated per-user in the reminder engine; not re-derived here.",
      missingArm,
    };

    // ── AI (last 30 days: operations + feedback mix) ───────────────────────
    const [aiLogs, feedbackGroups] = await Promise.all([
      db.aiLog.findMany({
        where: { createdAt: { gte: since } },
        select: {
          agent: true,
          success: true,
          fallbackUsed: true,
          handoff: true,
          safetyResult: true,
          latencyMs: true,
        },
      }),
      db.aiFeedback.groupBy({
        by: ["agent", "rating"],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
    ]);

    // safetyResult may carry a "|verify:<result>" suffix (P0-43 gate) —
    // aggregate on the BASE part, and treat emergency-priority routing as a
    // legitimate outcome, not a block (same rule as /api/ai-monitoring).
    const baseSafety = (s: string | null) => (s || "").split("|")[0];
    const isSafetyBlock = (s: string | null) =>
      baseSafety(s) !== "ok" && !baseSafety(s).startsWith("emergency_priority");

    const agentKeys = new Set<string>([
      ...FEEDBACK_AGENTS,
      ...aiLogs.map((l) => l.agent),
      ...feedbackGroups.map((g) => g.agent),
    ]);
    const perAgent = [...agentKeys].sort().map((agent) => {
      const rows = aiLogs.filter((l) => l.agent === agent);
      const latencies = rows.map((r) => r.latencyMs).filter((n) => n > 0);
      const feedback = { helpful: 0, unhelpful: 0, unsafe: 0 };
      for (const g of feedbackGroups) {
        if (g.agent === agent && g.rating in feedback) {
          feedback[g.rating as keyof typeof feedback] += g._count._all;
        }
      }
      return {
        agent,
        requests30d: rows.length,
        successRate: pct(rows.filter((r) => r.success).length, rows.length),
        fallbackRate: pct(rows.filter((r) => r.fallbackUsed).length, rows.length),
        handoffCount: rows.filter((r) => r.handoff).length,
        safetyBlocks: rows.filter((r) => isSafetyBlock(r.safetyResult)).length,
        avgLatencyMs: latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0,
        feedback,
      };
    });

    return json({
      success: true,
      generatedAt: new Date().toISOString(),
      window: "30d",
      deidentified: true,
      deidentificationNote:
        "Aggregates over all users. Contains no user ids, names, emails, or message content.",
      participants: {
        total: participantIds.size,
        consented: activeConsentUsers.size,
        revokedConsent: consents.length - activeConsentUsers.size,
        consentVersions,
        byArm,
        effectiveByArm,
      },
      doses: {
        total: doseTotal,
        byStatus: {
          taken: byStatus["taken"] ?? 0,
          skipped: byStatus["skipped"] ?? 0,
          missed: byStatus["missed"] ?? 0,
          pending: byStatus["pending"] ?? 0,
          delayed: byStatus["delayed"] ?? 0,
        },
        confirmationRate,
      },
      risk: {
        modelVersion: activeArtifact
          ? { version: activeArtifact.version, modelType: activeArtifact.modelType }
          : null,
        predictionsLast30d,
        highRiskShare,
        riskBuckets: {
          "0-0.2": bucketCounts[0],
          "0.2-0.4": bucketCounts[1],
          "0.4-0.6": bucketCounts[2],
          "0.6-0.8": bucketCounts[3],
          "0.8-1.0": bucketCounts[4],
        },
        mlAvailability: activeArtifact !== null,
      },
      dataQuality,
      ai: { perAgent },
    });
  } catch (error) {
    console.error("[research/overview] internal error:", (error as Error).message);
    return apiError("INTERNAL_ERROR", "Could not build the research overview. Please try again.");
  }
});
