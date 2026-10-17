/**
 * GET /api/metrics — latency report (plan §42): p50/p95/p99 + error counts
 * per instrumented route, from the in-memory recorder. Unauthenticated probe
 * data only (route names + milliseconds — nothing sensitive, §43).
 */
import { latencySnapshot } from "@/lib/server/metrics";

export async function GET() {
  const snapshot = latencySnapshot();
  return new Response(
    JSON.stringify(
      {
        status: "ok",
        note: "In-memory per-route latency samples (reset on restart). Sensitive data is never recorded.",
        routes: snapshot,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
