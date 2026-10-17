/** POST /api/auth/login — port of server/src/routes/auth.js (login).
 *
 * Phase 12: sets the HttpOnly `medsync_token` session cookie alongside the
 * body token (the body token remains for the socket.io bridge, which needs a
 * bearer credential it can put in the handshake auth payload).
 * Phase 3: accepts an optional client-detected `timeZone`
 * (Intl.DateTimeFormat().resolvedOptions().timeZone) and applies it safely.
 *
 * MASTER AUDIT hardening:
 *  - P0-13: sliding-window rate limits (per IP + per account, 1 minute).
 *  - P0-07: the account state is checked before any token is issued
 *    (disabled/suspended accounts are refused regardless of the password).
 *  - P0-08: the issued token carries the account's tokenVersion.
 *  - P0-49/50: the 500 path returns a controlled INTERNAL_ERROR, never the
 *    raw exception text; the detail stays in the server log.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { verifyPassword } from "@/lib/server/password";
import { signToken, sessionCookie } from "@/lib/server/jwt";
import { serializeUser } from "@/lib/server/serialize";
import startNotificationScheduler from "@/lib/server/notifications";
import { applyUserTimeZone } from "@/lib/server/user-timezone";
import {
  hitRateLimit,
  clientIp,
  tooManyRequests,
  LIMITS,
} from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  try {
    // P0-13 — IP-scoped limiter (brute-force across many accounts).
    const ip = clientIp(req);
    const ipDecision = hitRateLimit(`login:ip:${ip}`, LIMITS.login);
    if (!ipDecision.allowed) {
      return tooManyRequests(
        ipDecision.retryAfterMs,
        "Too many login attempts. Please wait a moment and try again."
      );
    }

    const { email, password, timeZone } = await readJson<{
      email: string;
      password: string;
      timeZone?: string;
    }>(req);

    // P0-13 — account-scoped limiter (targeted brute force).
    const accountKey = `login:email:${String(email || "").toLowerCase()}`;
    const accountDecision = hitRateLimit(accountKey, LIMITS.login);
    if (!accountDecision.allowed) {
      return tooManyRequests(
        accountDecision.retryAfterMs,
        "Too many login attempts for this account. Please wait a moment and try again."
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) return json({ message: "Invalid credentials" }, 400);

    // P0-07 — account state gate: a valid password is not enough.
    if (user.status === "disabled" || user.status === "suspended" || user.status === "deleted") {
      return json(
        { success: false, code: "ACCOUNT_DISABLED", message: "This account is not active. Please contact support." },
        403
      );
    }

    if (!user.isVerified) {
      return json(
        {
          message: "Please verify your account first",
          requiresVerification: true,
          email: user.email,
        },
        403
      );
    }

    if (!user.password) {
      return json(
        { message: "This account was created with Google. Please use Google Login." },
        400
      );
    }

    const isMatch = verifyPassword(password, user.password);
    if (!isMatch) return json({ message: "Invalid credentials" }, 400);

    // P0-08 — bind the session to the account's current tokenVersion.
    const token = signToken({ id: user.id, tv: user.tokenVersion });

    // Phase 3 — persist the client's detected timezone (safe: rebuilds only
    // the future scheduler window when it actually changes).
    const tzApplied = await applyUserTimeZone(user.id, timeZone);

    startNotificationScheduler({ user: { id: user.id, name: user.name, email: user.email } });

    // Serialize with the APPLIED timezone (the pre-fetch may predate the change).
    const refreshed = tzApplied.changed
      ? await db.user.findUnique({ where: { id: user.id } })
      : null;
    return json(
      { token, user: serializeUser(refreshed ?? user) },
      200,
      { "Set-Cookie": sessionCookie(token) }
    );
  } catch (err) {
    // P0-49/50 — controlled error; detail server-side only.
    console.error("[auth/login] internal error:", (err as Error).message);
    return json(
      { success: false, code: "INTERNAL_ERROR", message: "Login failed. Please try again." },
      500
    );
  }
}
