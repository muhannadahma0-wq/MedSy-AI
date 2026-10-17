/**
 * /api/study/consent — in-app research consent (v5 review item 42 / addition I).
 *
 *   GET    → the caller's consent state
 *            { success:true, consent:{ version, grantedAt, revokedAt } | null }
 *   POST   → grant / re-grant consent for the caller
 *            body { accept:true } — anything else is a VALIDATION_ERROR.
 *            Stores version = STUDY_CONSENT_VERSION || "1.0.0", grantedAt=now,
 *            revokedAt=null (upsert on userId).
 *   DELETE → revoke consent (revokedAt=now; grantedAt kept for audit).
 *            Idempotent: revoking an already-revoked or never-granted consent
 *            is still a success.
 *
 * Granting consent does NOT auto-assign a study arm — assignment stays with
 * the existing StudyAssignment mechanism (getStudyArm / /api/study/assign).
 * Research exports and the effective-arm gate read this table.
 */
import { db } from "@/lib/db";
import { json, readJson, apiError } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { hitRateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/** 10 consent changes / 10 minutes per user (grants + revocations). */
const CONSENT_LIMIT = { windowMs: 600_000, max: 10 };

const CURRENT_VERSION = process.env.STUDY_CONSENT_VERSION || "1.0.0";

type ConsentRow = { version: string; grantedAt: Date; revokedAt: Date | null };

function serializeConsent(row: ConsentRow) {
  return {
    version: row.version,
    grantedAt: row.grantedAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

export const GET = withMetrics("GET /api/study/consent", async (req: Request) => {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const consent = await db.studyConsent.findUnique({ where: { userId: guard.id } });
  return json({ success: true, consent: consent ? serializeConsent(consent) : null });
});

export const POST = withMetrics("POST /api/study/consent", async (req: Request) => {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const decision = hitRateLimit(`study-consent:user:${userId}`, CONSENT_LIMIT);
  if (!decision.allowed) {
    return tooManyRequests(
      decision.retryAfterMs,
      "Too many consent changes. Please wait a few minutes and try again."
    );
  }

  const body = await readJson<{ accept?: unknown }>(req);
  if (body.accept !== true) {
    return apiError(
      "VALIDATION_ERROR",
      "Consent must be granted explicitly — body must be { accept: true }."
    );
  }

  try {
    // Upsert on userId: re-granting refreshes version/grantedAt and clears
    // any previous revocation.
    const row = await db.studyConsent.upsert({
      where: { userId },
      update: { version: CURRENT_VERSION, grantedAt: new Date(), revokedAt: null },
      create: { userId, version: CURRENT_VERSION },
    });
    return json({ success: true, consent: serializeConsent(row) }, 201);
  } catch (error) {
    console.error("[study/consent] grant failed:", (error as Error).message);
    return apiError("INTERNAL_ERROR", "Could not record consent. Please try again.");
  }
});

export const DELETE = withMetrics("DELETE /api/study/consent", async (req: Request) => {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const decision = hitRateLimit(`study-consent:user:${guard.id}`, CONSENT_LIMIT);
  if (!decision.allowed) {
    return tooManyRequests(
      decision.retryAfterMs,
      "Too many consent changes. Please wait a few minutes and try again."
    );
  }

  try {
    const existing = await db.studyConsent.findUnique({ where: { userId: guard.id } });
    // Never granted → nothing to revoke (still a success; idempotent).
    if (!existing) {
      return json({ success: true, consent: null });
    }
    // Already revoked → return the stored state unchanged (idempotent).
    if (existing.revokedAt) {
      return json({ success: true, consent: serializeConsent(existing) });
    }
    const row = await db.studyConsent.update({
      where: { userId: guard.id },
      // grantedAt is intentionally kept — the audit trail of when consent
      // was FIRST given survives revocation.
      data: { revokedAt: new Date() },
    });
    return json({ success: true, consent: serializeConsent(row) });
  } catch (error) {
    console.error("[study/consent] revoke failed:", (error as Error).message);
    return apiError("INTERNAL_ERROR", "Could not record revocation. Please try again.");
  }
});
