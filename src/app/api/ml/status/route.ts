/**
 * GET /api/ml/status — active model, registered artifacts and the reminder
 * engine mode, for the Intelligence page.
 */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { getEngineMode } from "@/lib/server/reminder-engine";
import { withMetrics } from "@/lib/server/metrics";

function parseMetrics(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function handler_GET(req: Request) {
  // Phase 12 — BOLA guard: the query userId may only ever be the caller's own.
  const guard = await requireSelf(req, new URL(req.url).searchParams.get("userId"));
  if (guard instanceof Response) return guard;
  const userId = guard.id;
  void userId; // registry-level view; the guard enforces authentication/ownership

  const artifacts = await db.modelArtifact.findMany({
    orderBy: [{ isActive: "desc" }, { trainedAt: "desc" }],
  });

  const [predictions, reminderCounts] = await Promise.all([
    db.riskPrediction.count(),
    db.smartReminder.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  return json({
    success: true,
    engineMode: getEngineMode(),
    predictionsLogged: predictions,
    reminders: reminderCounts.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = g._count._all;
      return acc;
    }, {}),
    models: artifacts.map((a) => ({
      id: a.id,
      modelType: a.modelType,
      version: a.version,
      isActive: a.isActive,
      trainedAt: a.trainedAt.toISOString(),
      trainRows: a.trainRows,
      testRows: a.testRows,
      metrics: parseMetrics(a.metrics),
    })),
  });
}

export const GET = withMetrics("GET /api/ml/status", handler_GET);
