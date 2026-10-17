/**
 * POST /api/auth/logout — MASTER AUDIT P0-10/P1-62: logout must actually
 * invalidate the session, not just remove the client's copy of the token.
 *
 * What it does:
 *  - ALWAYS clears the HttpOnly `medsync_token` session cookie (the client
 *    cannot do this itself — HttpOnly is invisible to JS by design);
 *  - with { allDevices: true } it ALSO bumps User.tokenVersion, which
 *    invalidates every previously issued JWT for the account on every device
 *    (P0-08 — the "logout everywhere" / security-event path).
 *
 * Auth: accepts the current session (cookie or bearer) so the tokenVersion
 * bump can be attributed; anonymous calls are still allowed to clear the
 * cookie (logout is idempotent).
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { getAuthUser, clearSessionCookie } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{ allDevices?: boolean }>(req);
    const authUser = getAuthUser(req);

    if (body.allDevices && authUser) {
      // P0-08 — invalidate EVERY session of this account.
      await db.user.update({
        where: { id: authUser.id },
        data: { tokenVersion: { increment: 1 } },
      });
    }

    return json(
      {
        success: true,
        message: body.allDevices
          ? "Logged out everywhere. All sessions invalidated."
          : "Logged out successfully.",
        allDevices: Boolean(body.allDevices && authUser),
      },
      200,
      { "Set-Cookie": clearSessionCookie() }
    );
  } catch (err) {
    console.error("[auth/logout] internal error:", (err as Error).message);
    return json(
      { success: false, code: "INTERNAL_ERROR", message: "Logout failed." },
      500,
      // Best effort: still clear the cookie.
      { "Set-Cookie": clearSessionCookie() }
    );
  }
}

export const POST = withMetrics("POST /api/auth/logout", handler_POST);
