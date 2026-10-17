/**
 * POST /api/auth/signup — port of server/src/routes/auth.js (signup).
 * Sandbox note: there is no SMTP service, so sendOTPEmail() is a no-op and
 * the generated OTP is returned as `demoOtp` for the demo flow.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { hashPassword, generateOTP } from "@/lib/server/password";
import { normalizeTimeZone } from "@/lib/server/tz";
import { hitRateLimit, clientIp, tooManyRequests, LIMITS } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  try {
    // P0-13 — signup abuse limiter (5 accounts / 10 min per IP).
    const ipDecision = hitRateLimit(`signup:ip:${clientIp(req)}`, LIMITS.signup);
    if (!ipDecision.allowed) {
      return tooManyRequests(
        ipDecision.retryAfterMs,
        "Too many sign-up attempts from this network. Please try again later."
      );
    }

    const { name, email, password, timeZone } = await readJson<{
      name: string;
      email: string;
      password: string;
      timeZone?: string;
    }>(req);

    // Input validation — reject empty/missing required fields with a clear
    // 400 instead of a raw 500 (or a junk empty-account row).
    const missing: string[] = [];
    if (!name || !String(name).trim()) missing.push("name");
    if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) missing.push("email");
    if (!password || String(password).length < 8) missing.push("password");
    if (missing.length > 0) {
      return json(
        { message: `Invalid or missing fields: ${missing.join(", ")}`, fields: missing },
        400,
      );
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return json({ message: "User already exists" }, 400);

    const hashedPassword = hashPassword(password);
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        otpCode: otp,
        otpExpiresAt,
        isVerified: false,
        backupCodes: "[]",
        // Phase 3 — capture the client timezone at signup (validated; falls
        // back to the schema default "UTC" when absent/invalid).
        ...(normalizeTimeZone(timeZone) ? { timeZone: normalizeTimeZone(timeZone)! } : {}),
      },
    });

    // sendOTPEmail(email, otp) — no SMTP in the sandbox; log instead.
    console.log(`[OTP] Verification code for ${email}: ${otp}`);

    return json(
      {
        message: "User registered successfully. Please verify your email with the OTP sent.",
        requiresVerification: true,
        email,
        demoOtp: otp,
      },
      201
    );
  } catch (err) {
    // P0-49/50 — controlled error; detail server-side only.
    console.error("[auth/signup] internal error:", (err as Error).message);
    return json(
      { success: false, code: "INTERNAL_ERROR", message: "Registration failed. Please try again." },
      500
    );
  }
}
