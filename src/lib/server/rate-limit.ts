/**
 * MASTER AUDIT P0-13 — in-memory sliding-window rate limiter for the
 * authentication surface (login / signup / verify-otp / resend-otp / Google).
 *
 * Design notes:
 *  - Local memory only (project stack decision: no Redis/middleware). The
 *    store is anchored on globalThis exactly like metrics.ts, because dev-mode
 *    Turbopack re-instantiates modules per route and would otherwise give each
 *    freshly-compiled route its own empty limiter (BUG-013 class).
 *  - Keys combine the enforcement dimension the audit asks for:
 *      account + IP + time-window (e.g. "login:ip:1.2.3.4",
 *      "login:email:user@x.y" — both are checked on the login route).
 *  - Sliding window: an array of recent hit timestamps per key, pruned on read.
 *  - Failure semantics: when the limiter itself errors, the request is allowed
 *    through (rate limiting must not become a self-DoS); the failure is logged.
 */

interface LimiterStore {
  hits: Map<string, number[]>;
}

const STORE_KEY = "__medsyncRateLimitStore";
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: LimiterStore };
const store: LimiterStore = (globalStore[STORE_KEY] ??= { hits: new Map() });

export interface RateLimitDecision {
  allowed: boolean;
  /** Remaining hits inside the current window (0 when blocked). */
  remaining: number;
  /** Milliseconds until the window frees a slot (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimitOptions {
  /** Window size in milliseconds. */
  windowMs: number;
  /** Maximum hits inside the window. */
  max: number;
}

function prune(timestamps: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) i++;
  return i > 0 ? timestamps.slice(i) : timestamps;
}

/** Pure check — does NOT consume a slot. */
export function peekRateLimit(key: string, options: RateLimitOptions): RateLimitDecision {
  const now = Date.now();
  const timestamps = prune(store.hits.get(key) ?? [], now, options.windowMs);
  if (timestamps.length < options.max) {
    return { allowed: true, remaining: options.max - timestamps.length, retryAfterMs: 0 };
  }
  const oldestInWindow = timestamps[0];
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: Math.max(0, oldestInWindow + options.windowMs - now),
  };
}

/** Consume one slot; returns the decision AFTER the hit is recorded. */
export function hitRateLimit(key: string, options: RateLimitOptions): RateLimitDecision {
  try {
    const now = Date.now();
    const timestamps = prune(store.hits.get(key) ?? [], now, options.windowMs);
    if (timestamps.length >= options.max) {
      store.hits.set(key, timestamps);
      const oldestInWindow = timestamps[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, oldestInWindow + options.windowMs - now),
      };
    }
    timestamps.push(now);
    store.hits.set(key, timestamps);
    // Opportunistic cleanup: drop dead keys so the map cannot grow unbounded.
    if (store.hits.size > 5000) {
      for (const [k, v] of store.hits) {
        if (v.length === 0 || (v.length === 1 && now - v[0] > 3600_000)) store.hits.delete(k);
      }
    }
    return { allowed: true, remaining: options.max - timestamps.length, retryAfterMs: 0 };
  } catch (err) {
    console.error("[rate-limit] limiter failure (fail-open):", (err as Error).message);
    return { allowed: true, remaining: 1, retryAfterMs: 0 };
  }
}

/** Extract the caller IP for IP-scoped keys (best effort, proxy-aware). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Ready-to-return 429 Response with the standard error contract. */
export function tooManyRequests(retryAfterMs: number, message: string): Response {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new Response(
    JSON.stringify({
      success: false,
      code: "RATE_LIMITED",
      message,
      retryAfterSeconds: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Presets used by the auth routes (deliberately generous enough for the
// self-verification suites, strict enough for brute-force protection).
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Login: 12 attempts / minute per IP, 12 / minute per account. */
  login: { windowMs: 60_000, max: 12 },
  /** Signup: 5 new accounts / 10 minutes per IP. */
  signup: { windowMs: 600_000, max: 5 },
  /** OTP verification: 10 attempts / minute per account (plus the stored
   *  otpRetryCount hard cap of 5 wrong codes per issued OTP). */
  verifyOtp: { windowMs: 60_000, max: 10 },
  /** OTP resend requests: 3 / 10 minutes per account. */
  resendOtp: { windowMs: 600_000, max: 3 },
  /** Google login attempts: 12 / minute per IP. */
  google: { windowMs: 60_000, max: 12 },
  /** Report uploads: 10 / 10 minutes per user (P1-48). */
  upload: { windowMs: 600_000, max: 10 },
} as const;
