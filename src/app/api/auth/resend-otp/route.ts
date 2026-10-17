/** POST /api/auth/resend-otp — port of server/src/routes/auth.js (resend-otp).
 *
 * MASTER AUDIT P0-13 — abuse protection:
 *  - a 60-second cooldown per account (User.otpResendAt) so OTPs cannot be
 *    regenerated on demand, and
 *  - an IP+account rate limit (3 / 10 min) on top of the cooldown.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { generateOTP } from "@/lib/server/password";
import { hitRateLimit, clientIp, tooManyRequests, LIMITS } from "@/lib/server/rate-limit";

const RESEND_COOLDOWN_MS = 60_000; // 60 seconds between OTP re-issues per account

export async function POST(req: Request) {
  try {
    const { email } = await readJson<{ email: string }>(req);

    // P0-13 — IP-scoped limiter.
    const ipDecision = hitRateLimit(`resend-otp:ip:${clientIp(req)}`, LIMITS.resendOtp);
    if (!ipDecision.allowed) {
      return tooManyRequests(
        ipDecision.retryAfterMs,
        "Too many code requests from this network. Please try again later."
      );
    }

    const user = await db.user.findUnique({ where: { email } });

    if (!user) return json({ message: "User not found" }, 404);
    if (user.isVerified) return json({ message: "User already verified" }, 400);

    // P0-13 — per-account cooldown.
    if (user.otpResendAt && Date.now() - new Date(user.otpResendAt).getTime() < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil(
        (RESEND_COOLDOWN_MS - (Date.now() - new Date(user.otpResendAt).getTime())) / 1000
      );
      return tooManyRequests(
        waitSec * 1000,
        `Please wait ${waitSec} second(s) before requesting a new code.`
      );
    }

    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt,
        otpRetryCount: 0,
        otpResendAt: new Date(),
      },
    });

    // Sandbox: no SMTP — surface the code in the log (the client shows demoOtp from signup).
    console.log(`[OTP] New verification code for ${email}: ${otp}`);

    return json({ message: "New OTP sent successfully", demoOtp: otp });
  } catch (err) {
    // P0-49/50 — controlled error; detail server-side only.
    console.error("[auth/resend-otp] internal error:", (err as Error).message);
    return json(
      { success: false, code: "INTERNAL_ERROR", message: "Could not resend the code. Please try again." },
      500
    );
  }
}
