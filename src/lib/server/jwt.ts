import crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Minimal JWT (HS256) implementation — port of the original server's
 * jsonwebtoken usage (server/src/routes/auth.js, middlewares/authMiddleware.js)
 * without adding a dependency. Tokens carry { id } and expire in 1 day,
 * exactly like the original: jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1d" }).
 *
 * Phase 12 (master plan): the token is ALSO delivered as an HttpOnly
 * `medsync_token` cookie (set by login/signup/verify-otp/OAuth). `getAuthUser`
 * accepts Bearer header (socket bridge + API clients) OR the cookie — the
 * cookie path keeps the token out of JS-reachable storage for normal HTTP.
 *
 * MASTER AUDIT P0-08 — session versioning: the token also carries `tv`
 * (tokenVersion). `requireSelf` verifies it against the stored user row, so
 * bumping User.tokenVersion (password change, security event, admin disable,
 * logout-all-devices) invalidates every previously issued token immediately.
 * Tokens issued before this field existed decode as tv=0 and stay valid until
 * the stored version is bumped.
 */

const JWT_SECRET = process.env.JWT_SECRET || "medsync-ai-sandbox-secret";
const EXPIRES_IN_SECONDS = 60 * 60 * 24; // 1d
export const SESSION_COOKIE_NAME = "medsync_token";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(input: string): Buffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

export function signToken(payload: { id: string; tv?: number }): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({ ...payload, iat: now, exp: now + EXPIRES_IN_SECONDS })
  );
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest();
  return `${header}.${body}.${base64url(signature)}`;
}

export function verifyToken(token: string): { id: string; tv?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = base64url(
      crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
    );
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(fromBase64url(body).toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // TokenExpiredError equivalent
    }
    if (!payload.id) return null;
    // P0-08 — missing tv means a pre-versioning token: treated as version 0.
    return { id: String(payload.id), tv: typeof payload.tv === "number" ? payload.tv : 0 };
  } catch {
    return null;
  }
}

/** Port of middlewares/authMiddleware.js — extracts { id } from Bearer token
 *  or the HttpOnly session cookie (Phase 12).
 *
 *  NOTE (MASTER AUDIT): this verifies the TOKEN ONLY (signature + expiry).
 *  For request authorization always prefer `requireSelf`, which additionally
 *  verifies the account exists, is active, and the session version matches
 *  (P0-07/P0-08). `getAuthUser` remains for the loopback socket bridge and
 *  internal scheduler, where the caller is the platform itself. */
export function getAuthUser(req: Request): { id: string; tv?: number } | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    if (token && token.trim() !== "" && token !== "null" && token !== "undefined") {
      const user = verifyToken(token);
      if (user) return user;
    }
  }

  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE_NAME) {
        const token = decodeURIComponent(rest.join("="));
        if (token) {
          const user = verifyToken(token);
          if (user) return user;
        }
      }
    }
  }
  return null;
}

/** Set-Cookie value for the HttpOnly session cookie (Phase 12). */
export function sessionCookie(token: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${EXPIRES_IN_SECONDS}`
  );
}

/** Clears the session cookie (logout). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * MASTER AUDIT P0-07 — the full verification chain, on every call:
 *
 *   token valid → user EXISTS → account ACTIVE → session version matches
 *              → (optional) requested id is the caller's own
 *
 * Async because the account state is read from the database — the JWT alone
 * is never an authorization credential for a healthcare application.
 *
 * BOLA/IDOR guard for routes that address a user by id (query param, URL
 * param or body). Returns the authenticated id, or a ready-to-return
 * 401/403 Response when the caller is not allowed to act as that user:
 *
 *   const guard = await requireSelf(req, requestedUserId);
 *   if (guard instanceof Response) return guard;
 *   // guard.id is the authenticated user id (=== requestedUserId when given)
 */
export async function requireSelf(
  req: Request,
  requestedUserId?: string | null
): Promise<{ id: string } | Response> {
  const authUser = getAuthUser(req);
  if (!authUser) {
    return new Response(
      JSON.stringify({ success: false, message: "User not authenticated" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  if (requestedUserId && requestedUserId !== authUser.id) {
    return new Response(
      JSON.stringify({ success: false, message: "Forbidden — you can only access your own resources" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  try {
    const account = await db.user.findUnique({
      where: { id: authUser.id },
      select: { status: true, tokenVersion: true },
    });
    // P0-07 — deleted/nonexistent account: the token no longer maps to a user.
    if (!account) {
      return new Response(
        JSON.stringify({ success: false, message: "User not authenticated" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    // P0-07 — disabled/suspended accounts keep their tokens but lose access.
    if (account.status !== "active") {
      return new Response(
        JSON.stringify({
          success: false,
          code: "ACCOUNT_DISABLED",
          message: "This account is not active. Please contact support.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    // P0-08 — session version mismatch: token issued before a security event.
    if ((authUser.tv ?? 0) !== account.tokenVersion) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "SESSION_INVALIDATED",
          message: "Session expired. Please log in again.",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    // Fail-closed: when the account state cannot be verified, access is denied.
    console.error("[auth] account-state verification failed:", (err as Error).message);
    return new Response(
      JSON.stringify({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Unable to verify the account. Please try again.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  return { id: authUser.id };
}
