/**
 * GET /api/ai-monitoring — AI monitoring feed (spec §45).
 *
 * Per-agent operational stats aggregated from the AiLog audit table:
 * requests, success rate, fallback rate, latency (avg + p95), handoffs,
 * safety interventions — plus the CURRENT provider-chain configuration
 * resolved from env (so the dashboard shows what would answer, not what
 * was hardcoded).
 *
 * Data minimization: the log stores no full medical text; this endpoint
 * exposes only aggregates and short previews.
 */
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { db } from "@/lib/db";
import { agentChainConfig, SAFETY_RULES_VERSION } from "@/lib/server/ai/gateway";
import { AGENTS, CAPABILITIES_MATRIX } from "@/lib/server/ai/agent-registry";
import { providerHealth } from "@/lib/server/ai/providers";
import { withMetrics } from "@/lib/server/metrics";

const AGENT_KEYS = [
  "medical",
  "medicine",
  "personal-health",
  "emergency",
  "vision-medication",
  "vision-report",
] as const;

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

async function handler_GET(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const url = new URL(req.url);
  const hours = Math.min(Math.max(parseInt(url.searchParams.get("hours") || "168", 10) || 168, 1), 720);
  const since = new Date(Date.now() - hours * 3600000);

  const logs = await db.aiLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      agent: true, provider: true, model: true, latencyMs: true, success: true,
      fallbackUsed: true, handoff: true, safetyResult: true, severity: true,
      intent: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const agents = AGENT_KEYS.map((key) => {
    const rows = logs.filter((l) => l.agent === key);
    const latencies = rows.map((r) => r.latencyMs).filter((n) => n > 0);
    const providers = [...new Set(rows.map((r) => r.provider))];
    // safetyResult may carry a "|verify:<result>" suffix from the P0-43
    // verification gate — aggregate on the BASE part.
    const baseSafety = (s: string | null) => (s || "").split("|")[0];
    const safetyBlocks = rows.filter(
      (r) =>
        baseSafety(r.safetyResult) !== "ok" &&
        baseSafety(r.safetyResult) !== "emergency_priority:emergency" &&
        baseSafety(r.safetyResult) !== "emergency_priority:urgent"
    ).length;
    const emergencyPriorities = rows.filter((r) => baseSafety(r.safetyResult).startsWith("emergency_priority")).length;
    // P0-43 — verification-gate outcome distribution (pass/warnings/corrected).
    const verify = (r: { safetyResult: string | null }) =>
      (r.safetyResult || "").split("|").find((p) => p.startsWith("verify:"))?.slice(8) || null;
    const lastUsed = rows[0]?.createdAt || null;
    return {
      agent: key,
      display: AGENTS[key as keyof typeof AGENTS]?.display || {
        en: key === "vision-medication" ? "Vision — Medication Images" : "Vision — Report Images",
        ar: key === "vision-medication" ? "الرؤية — صور الأدوية" : "الرؤية — صور التقارير",
      },
      providerChain: agentChainConfig()[key] || agentChainConfig().vision,
      providersUsed: providers,
      requests: rows.length,
      successRate: pct(rows.filter((r) => r.success).length, rows.length),
      fallbackRate: pct(rows.filter((r) => r.fallbackUsed).length, rows.length),
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0,
      p95LatencyMs: p95(latencies),
      errors: rows.filter((r) => !r.success).length,
      handoffs: rows.filter((r) => r.handoff).length,
      safetyBlocks,
      emergencyPriorities,
      verification: {
        pass: rows.filter((r) => verify(r) === "pass").length,
        warnings: rows.filter((r) => verify(r) === "warnings").length,
        corrected: rows.filter((r) => verify(r) === "corrected").length,
      },
      lastUsed,
    };
  });

  const recent = logs.slice(0, 40).map((l) => ({
    agent: l.agent,
    provider: l.provider,
    intent: l.intent,
    severity: l.severity,
    fallbackUsed: l.fallbackUsed,
    handoff: l.handoff,
    safetyResult: l.safetyResult,
    latencyMs: l.latencyMs,
    success: l.success,
    createdAt: l.createdAt,
  }));

  // v5 review item 38/H — AI feedback loop (AiFeedback table): per-agent
  // 👍 helpful / 👎 unhelpful / ⚠️ unsafe counts over a FIXED 30-day window
  // (independent of the ?hours= parameter, so the feedback mix stays
  // comparable across dashboards — /api/research/overview uses the same
  // window). Additive section; every pre-existing field is unchanged.
  const FEEDBACK_WINDOW_MS = 30 * 24 * 3600 * 1000;
  const feedbackGroups = await db.aiFeedback.groupBy({
    by: ["agent", "rating"],
    _count: { _all: true },
    where: { createdAt: { gte: new Date(Date.now() - FEEDBACK_WINDOW_MS) } },
  });
  const feedbackByAgent = new Map<
    string,
    { helpful: number; unhelpful: number; unsafe: number }
  >();
  for (const g of feedbackGroups) {
    const entry = feedbackByAgent.get(g.agent) ?? { helpful: 0, unhelpful: 0, unsafe: 0 };
    if (g.rating === "helpful" || g.rating === "unhelpful" || g.rating === "unsafe") {
      entry[g.rating] += g._count._all;
    }
    feedbackByAgent.set(g.agent, entry);
  }
  const feedbackTotals = { helpful: 0, unhelpful: 0, unsafe: 0 };
  const feedbackPerAgent = [...feedbackByAgent.entries()]
    .map(([agent, counts]) => {
      feedbackTotals.helpful += counts.helpful;
      feedbackTotals.unhelpful += counts.unhelpful;
      feedbackTotals.unsafe += counts.unsafe;
      return {
        agent,
        ...counts,
        total: counts.helpful + counts.unhelpful + counts.unsafe,
      };
    })
    .sort((a, b) => a.agent.localeCompare(b.agent));

  return json({
    success: true,
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    // MASTER AUDIT P2-56 / P1-45 — versioned policy + live breaker health.
    policyVersion: SAFETY_RULES_VERSION,
    providerHealth: providerHealth(),
    config: agentChainConfig(),
    capabilitiesMatrix: CAPABILITIES_MATRIX,
    agents,
    totals: {
      requests: logs.length,
      successRate: pct(logs.filter((l) => l.success).length, logs.length),
      fallbackRate: pct(logs.filter((l) => l.fallbackUsed).length, logs.length),
      handoffs: logs.filter((l) => l.handoff).length,
      safetyInterventions: logs.filter(
        (l) => (l.safetyResult || "").split("|")[0] !== "ok"
      ).length,
    },
    recent,
    feedback: {
      windowDays: 30,
      perAgent: feedbackPerAgent,
      totals: feedbackTotals,
    },
  });
}

export const GET = withMetrics("GET /api/ai-monitoring", handler_GET);
