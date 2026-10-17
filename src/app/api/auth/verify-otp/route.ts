/** POST /api/auth/verify-otp — port of server/src/routes/auth.js (verify-otp).
 * Phase 12: crypto-random backup codes, HttpOnly session cookie.
 * Phase 3: applies the client-detected timezone.
 *
 * MASTER AUDIT hardening:
 *  - P0-13: endpoint rate limit (10/min per account) on top of the stored
 *    otpRetryCount hard cap of 5 wrong codes per issued OTP.
 *  - P0-12: backup codes are generated with crypto.randomBytes AND stored as
 *    SHA-256 hashes — the plaintext is shown exactly once, in this response.
 *  - P0-07: account state gate before any token is issued.
 *  - P0-08: the issued token carries the account's tokenVersion.
 */
import crypto from "crypto";
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { signToken, sessionCookie } from "@/lib/server/jwt";
import { serializeUser } from "@/lib/server/serialize";
import startNotificationScheduler from "@/lib/server/notifications";
import { applyUserTimeZone } from "@/lib/server/user-timezone";
import { hitRateLimit, tooManyRequests, LIMITS } from "@/lib/server/rate-limit";

/** P0-12 — one-way hash before storage; plaintext exists only in the response. */
function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(req: Request) {
  try {
    const { email, otp, timeZone } = await readJson<{
      email: string;
      otp: string;
      timeZone?: string;
    }>(req);

    // P0-13 — per-account limiter (blocks code spraying independent of the
    // stored per-OTP retry counter).
    const accountKey = `verify-otp:email:${String(email || "").toLowerCase()}`;
    const decision = hitRateLimit(accountKey, LIMITS.verifyOtp);
    if (!decision.allowed) {
      return tooManyRequests(
        decision.retryAfterMs,
        "Too many verification attempts. Please wait a moment and try again."
      );
    }

    const user = await db.user.findUnique({ where: { email } });

    if (!user) return json({ message: "User not found" }, 404);
    if (user.isVerified) return json({ message: "User already verified" }, 400);

    // P0-07 — account state gate.
    if (user.status === "disabled" || user.status === "suspended" || user.status === "deleted") {
      return json(
        { success: false, code: "ACCOUNT_DISABLED", message: "This account is not active. Please contact support." },
        403
      );
    }

    if (user.otpCode !== otp) {
      const retryCount = user.otpRetryCount + 1;
      await db.user.update({ where: { id: user.id }, data: { otpRetryCount: retryCount } });
      if (retryCount >= 5) {
        return json({ message: "Too many failed attempts. Please request a new OTP." }, 400);
      }
      return json({ message: "Invalid OTP" }, 400);
    }

    if (user.otpExpiresAt && new Date() > user.otpExpiresAt) {
      return json({ message: "OTP expired. Please request a new one." }, 400);
    }

    // Generate backup codes on first verification — crypto-random (Phase 12);
    // stored as SHA-256 hashes, shown to the user exactly once (P0-12).
    const backupCodes = Array.from({ length: 5 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );
    const backupCodeHashes = backupCodes.map(hashBackupCode);

    await db.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        otpRetryCount: 0,
        otpResendAt: null,
        backupCodes: JSON.stringify(backupCodeHashes),
      },
    });

    startNotificationScheduler({ user: { id: user.id, name: user.name, email: user.email } });

    // P0-08 — bind the session to the account's current tokenVersion.
    const token = signToken({ id: user.id, tv: user.tokenVersion });
    const updated = await db.user.findUnique({ where: { id: user.id } });

    // Phase 3 — capture the client timezone at this login-equivalent moment.
    await applyUserTimeZone(user.id, timeZone);

    return json(
      {
        message: "Account verified successfully",
        token,
        user: updated ? serializeUser(updated) : { id: user.id, name: user.name, email: user.email },
        backupCodes,
      },
      200,
      { "Set-Cookie": sessionCookie(token) }
    );
  } catch (err) {
    // P0-49/50 — controlled error; detail server-side only.
    console.error("[auth/verify-otp] internal error:", (err as Error).message);
    return json(
      { success: false, code: "INTERNAL_ERROR", message: "Verification failed. Please try again." },
      500
    );
  }
}
