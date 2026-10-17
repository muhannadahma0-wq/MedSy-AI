/**
 * GET /api/intelligence/overview — single call powering the Intelligence page:
 * adherence summary (DoseEvent-based), risk forecast with explanations for
 * upcoming doses, recent dose-event history, active model + metrics, engine
 * mode and the reminder ledger.
 */
import { db } from "@/lib/db";
import { withMetrics } from "@/lib/server/metrics";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { getAdherenceSummary } from "@/lib/server/adherence-engine";
import { getEngineMode } from "@/lib/server/reminder-engine";
import { getStudyArm, ARM_DESCRIPTIONS } from "@/lib/server/study";
import { DISCLAIMER_AR, DISCLAIMER_EN } from "@/lib/server/ml/predict";
import type { ExplanationItem } from "@/lib/server/ml/predict";

function parseJsonOr<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const GET = withMetrics("GET /api/intelligence/overview", async (req: Request) => {
  // Phase 12 — BOLA guard: the query userId may only ever be the caller's own.
  const queryUser = new URL(req.url).searchParams.get("userId");
  const guard = await requireSelf(req, queryUser);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const now = new Date();
  const horizon = new Date(now.getTime() + 48 * 3600 * 1000);

  const [summary, meds, upcoming, history, activeModel, predictionCount, reminderGroups, recentReminders, allArtifacts, studyInfo, armGroups] =
    await Promise.all([
      getAdherenceSummary(userId, 30),
      db.medication.findMany({ where: { userId }, select: { id: true, pillName: true, dosageAmount: true } }),
      db.doseEvent.findMany({
        where: { userId, status: "pending", scheduledAt: { gte: new Date(now.getTime() - 2 * 3600 * 1000), lte: horizon } },
        orderBy: { scheduledAt: "asc" },
        take: 30,
      }),
      db.doseEvent.findMany({
        where: { userId, status: { in: ["taken", "delayed", "missed", "skipped"] } },
        orderBy: { scheduledAt: "desc" },
        take: 30,
      }),
      db.modelArtifact.findFirst({ where: { isActive: true }, orderBy: { trainedAt: "desc" } }),
      db.riskPrediction.count({ where: { userId } }),
      db.smartReminder.groupBy({ by: ["status"], _count: { _all: true }, where: { userId } }),
      db.smartReminder.findMany({ where: { userId }, orderBy: { scheduledAt: "desc" }, take: 20 }),
      db.modelArtifact.findMany({ orderBy: { trainedAt: "desc" } }),
      getStudyArm(userId),
      db.studyAssignment.groupBy({ by: ["arm"], _count: { _all: true } }),
    ]);

  // Latest artifact per modelType — the four-candidate comparison view (plan §16).
  const CANDIDATE_ORDER = ["baseline", "logistic-regression", "gradient-boosting", "random-forest"];
  const latestByType = new Map<string, (typeof allArtifacts)[number]>();
  for (const a of allArtifacts) {
    if (!latestByType.has(a.modelType)) latestByType.set(a.modelType, a);
  }
  const modelCandidates = CANDIDATE_ORDER.filter((t) => latestByType.has(t)).map((t) => {
    const a = latestByType.get(t)!;
    return {
      modelType: a.modelType,
      version: a.version,
      isActive: a.isActive,
      trainedAt: a.trainedAt.toISOString(),
      metrics: parseJsonOr<Record<string, unknown>>(a.metrics, {}),
    };
  });

  // Tree ensembles explain via global feature importance, not signed per-dose
  // attribution (plan §25 — no fabricated reasons).
  const explanationKind: "per-dose" | "global-importance" =
    activeModel?.modelType === "random-forest" || activeModel?.modelType === "gradient-boosting"
      ? "global-importance"
      : "per-dose";

  const medById = new Map(meds.map((m) => [m.id, m]));

  // Attach the latest stored prediction (features + explanation) per event.
  const withExplanations = await Promise.all(
    upcoming.map(async (e) => {
      const latest = await db.riskPrediction.findFirst({
        where: { doseEventId: e.id },
        orderBy: { createdAt: "desc" },
      });
      return {
        id: e.id,
        medicationName: medById.get(e.medicationId)?.pillName ?? "Unknown medication",
        dosageAmount: medById.get(e.medicationId)?.dosageAmount ?? null,
        scheduledAt: e.scheduledAt.toISOString(),
        slotTime: e.slotTime,
        status: e.status,
        riskScore: e.riskScore,
        riskLevel: e.riskLevel,
        modelVersion: e.modelVersion,
        explanation: latest ? parseJsonOr<ExplanationItem[]>(latest.explanation, []) : [],
        explanationKind,
        predictedAt: latest ? latest.createdAt.toISOString() : null,
        mode: latest?.mode ?? null,
      };
    })
  );

  return json({
    success: true,
    generatedAt: now.toISOString(),
    engineMode: getEngineMode(),
    disclaimers: { en: DISCLAIMER_EN, ar: DISCLAIMER_AR },
    adherence: summary,
    forecast: withExplanations,
    history: history.map((e) => ({
      id: e.id,
      medicationName: medById.get(e.medicationId)?.pillName ?? "Unknown medication",
      scheduledAt: e.scheduledAt.toISOString(),
      actualAt: e.actualAt ? e.actualAt.toISOString() : null,
      status: e.status,
      delayMinutes: e.delayMinutes,
      riskScore: e.riskScore,
      riskLevel: e.riskLevel,
      source: e.source,
    })),
    model: activeModel
      ? {
          modelType: activeModel.modelType,
          version: activeModel.version,
          trainedAt: activeModel.trainedAt.toISOString(),
          trainRows: activeModel.trainRows,
          testRows: activeModel.testRows,
          metrics: parseJsonOr<Record<string, unknown>>(activeModel.metrics, {}),
        }
      : null,
    predictionsLogged: predictionCount,
    modelCandidates,
    study: {
      arm: studyInfo.arm,
      assignedAt: studyInfo.assignedAt,
      reason: studyInfo.reason,
      description: ARM_DESCRIPTIONS[studyInfo.arm],
      participants: {
        total: armGroups.reduce((a, g) => a + g._count._all, 0),
        control: armGroups.find((g) => g.arm === "control")?._count._all ?? 0,
        smart: armGroups.find((g) => g.arm === "smart")?._count._all ?? 0,
      },
    },
    reminders: {
      counts: reminderGroups.reduce<Record<string, number>>((acc, g) => {
        acc[g.status] = g._count._all;
        return acc;
      }, {}),
      recent: recentReminders.map((r) => ({
        id: r.id,
        type: r.type,
        scheduledAt: r.scheduledAt.toISOString(),
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        status: r.status,
        mode: r.mode,
        riskLevel: r.riskLevel,
        riskScore: r.riskScore,
        payload: parseJsonOr<{ title?: string; message?: string }>(r.payload, {}),
      })),
    },
  });
});
