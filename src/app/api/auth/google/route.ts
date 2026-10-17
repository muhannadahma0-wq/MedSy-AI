/**
 * POST /api/auth/google — port of server/src/routes/auth.js (google login).
 * Verifying a Google ID token requires GOOGLE_CLIENT_ID credentials which
 * are not configured in this sandbox, so the route responds exactly like
 * the original does when token verification fails.
 */
import { json, readJson } from "@/lib/server/http";
import { hitRateLimit, clientIp, tooManyRequests, LIMITS } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  try {
    // MASTER AUDIT P0-13 — IP-scoped limiter on the Google login surface.
    const ipDecision = hitRateLimit(`google:ip:${clientIp(req)}`, LIMITS.google);
    if (!ipDecision.allowed) {
      return tooManyRequests(
        ipDecision.retryAfterMs,
        "Too many Google login attempts. Please wait a moment and try again."
      );
    }

    const { credential } = await readJson<{ credential?: string }>(req);
    if (!credential) {
      return json({ message: "Invalid Google token" }, 400);
    }
    // google.auth.OAuth2(...).verifyIdToken(...) — unavailable without credentials.
    console.error("Google verify error: GOOGLE_CLIENT_ID is not configured in this environment.");
    return json({ message: "Invalid Google token" }, 400);
  } catch {
    return json({ message: "Invalid Google token" }, 400);
  }
}
