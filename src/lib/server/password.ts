import crypto from "crypto";

/**
 * Password hashing — replaces bcryptjs from the original server
 * (server/src/routes/auth.js) with the Node built-in scrypt KDF.
 * Stored format: "scrypt:<saltHex>:<hashHex>"
 */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split(":");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Port of utils/otpUtils.js — Phase 12: crypto-random (Math.random is
 *  predictable and was flagged by the plan's security audit). */
export function generateOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}
