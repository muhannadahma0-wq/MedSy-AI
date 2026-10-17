/**
 * MEDSYNC observability (plan §42–43) — lightweight in-memory latency metrics.
 *
 * Records per-route durations with reservoir-free exact storage capped per
 * route (oldest dropped). Reports p50/p95/p99 + count + error hits. Nothing
 * sensitive is ever recorded: route names and milliseconds only — no JWTs,
 * passwords, OTPs, OAuth tokens or medical data (plan §43 red-line).
 */

interface RouteStats {
  samples: number[]; // ring of recent durations (ms)
  cursor: number;
  errors: number;
}

const MAX_SAMPLES_PER_ROUTE = 500;

/**
 * Dev-mode module fragmentation guard (BUG-013 class): Turbopack lazily
 * re-instantiates modules per route compilation, so a module-level Map would
 * give each freshly-compiled route its OWN empty metrics store (observed:
 * wave-2 routes recorded nothing). Anchoring the store on globalThis keeps a
 * single shared instance across every module instantiation — identical
 * behaviour in dev and production builds.
 */
interface MetricsStore {
  routes: Map<string, RouteStats>;
}

const STORE_KEY = "__medsyncLatencyStore";
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: MetricsStore };
const store: MetricsStore = (globalStore[STORE_KEY] ??= { routes: new Map() });
const routes = store.routes;

export function recordLatency(route: string, ms: number, isError = false): void {
  let stats = routes.get(route);
  if (!stats) {
    stats = { samples: new Array(MAX_SAMPLES_PER_ROUTE).fill(-1), cursor: 0, errors: 0 };
    routes.set(route, stats);
  }
  stats.samples[stats.cursor] = ms;
  stats.cursor = (stats.cursor + 1) % MAX_SAMPLES_PER_ROUTE;
  if (isError) stats.errors++;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

export interface LatencySnapshot {
  route: string;
  count: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  meanMs: number | null;
}

export function latencySnapshot(): LatencySnapshot[] {
  const out: LatencySnapshot[] = [];
  for (const [route, stats] of routes) {
    const valid = stats.samples.filter((s) => s >= 0).sort((a, b) => a - b);
    if (valid.length === 0) continue;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    out.push({
      route,
      count: valid.length,
      errors: stats.errors,
      p50Ms: percentile(valid, 50),
      p95Ms: percentile(valid, 95),
      p99Ms: percentile(valid, 99),
      meanMs: Number(mean.toFixed(1)),
    });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Wraps an API handler with automatic latency recording and a per-request
 * correlation id (MASTER AUDIT P1-55): every JSON response carries an
 * `x-request-id` header so a user-reported issue maps to exactly one
 * server-side request. Usage: export const GET = withMetrics("GET /api/x", handler);
 */
export function withMetrics<T extends unknown[]>(
  route: string,
  handler: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    const started = Date.now();
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${started}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await handler(...args);
      recordLatency(route, Date.now() - started, res.status >= 500);
      // Response headers are immutable — rebuild with the correlation id.
      const headers = new Headers(res.headers);
      headers.set("x-request-id", requestId);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    } catch (err) {
      recordLatency(route, Date.now() - started, true);
      throw err;
    }
  };
}
