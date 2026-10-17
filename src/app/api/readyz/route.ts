/**
 * GET /api/readyz — readiness probe (plan §43). Verifies the dependencies the
 * request path actually needs: database reachable, ML registry resolvable and
 * the reminder engine mode. Returns 503 (not ready) instead of a hard error so
 * orchestrators can wait. Nothing sensitive is exposed.
 */
import { db } from "@/lib/db";
import { getEngineMode } from "@/lib/server/reminder-engine";
import { withMetrics } from "@/lib/server/metrics";

const BOOTED_AT = Date.now();

async function handler_GET() {
  const checks: Record<string, { ok: boolean; detail?: string; latencyMs?: number }> = {};

  // 1. Database
  const dbStarted = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - dbStarted };
  } catch (err) {
    checks.database = { ok: false, detail: (err as Error).message };
  }

  // 2. ML registry (model artifacts table reachable + any active model)
  try {
    const active = await db.modelArtifact.findFirst({ where: { isActive: true } });
    checks.mlRegistry = {
      ok: true,
      detail: active ? `${active.modelType}/${active.version}` : "no-active-model (baseline fallback)",
    };
  } catch (err) {
    checks.mlRegistry = { ok: false, detail: (err as Error).message };
  }

  // 3. DoseEvent source of truth
  try {
    const events = await db.doseEvent.count();
    checks.doseEvents = { ok: true, detail: `${events} events` };
  } catch (err) {
    checks.doseEvents = { ok: false, detail: (err as Error).message };
  }

  const ready = Object.values(checks).every((c) => c.ok);

  return new Response(
    JSON.stringify({
      status: ready ? "ready" : "not-ready",
      checks,
      engineMode: getEngineMode(),
      uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
      timestamp: new Date().toISOString(),
    }),
    {
      status: ready ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export const GET = withMetrics("GET /api/readyz", handler_GET);
