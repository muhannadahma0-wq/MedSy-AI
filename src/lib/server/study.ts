/**
 * Controlled-study arm assignment (plan Sections 27–32).
 *
 * Control arm  = normal reminders + ML scoring, NO extra reminder.
 * Smart arm    = normal reminders + ML scoring + EXTRA reminder for predicted
 *                high-risk doses.
 *
 * Assignment is persisted (StudyAssignment) and balanced: new participants
 * alternate control/smart by the current assignment count. The operator
 * endpoint (/api/study/assign) is intended for pilot setup by the researcher
 * only — participants never self-select an arm.
 */

import { db } from "@/lib/db";

export type StudyArm = "control" | "smart";

export interface StudyArmInfo {
  arm: StudyArm;
  assignedAt: string;
  reason: string;
}

function isArm(value: string): value is StudyArm {
  return value === "control" || value === "smart";
}

/**
 * Returns the user's study arm, auto-assigning a balanced arm on first lookup.
 * The write is race-tolerant: the unique userId constraint makes concurrent
 * first lookups collapse to a single stored assignment.
 */
export async function getStudyArm(userId: string): Promise<StudyArmInfo> {
  const existing = await db.studyAssignment.findUnique({ where: { userId } });
  if (existing && isArm(existing.arm)) {
    return {
      arm: existing.arm,
      assignedAt: existing.assignedAt.toISOString(),
      reason: existing.reason ?? "auto-balanced",
    };
  }

  // Balanced auto-assignment: alternate by current participant count.
  const count = await db.studyAssignment.count();
  const arm: StudyArm = count % 2 === 0 ? "control" : "smart";
  try {
    const created = await db.studyAssignment.create({
      data: { userId, arm, reason: "auto-balanced" },
    });
    return {
      arm,
      assignedAt: created.assignedAt.toISOString(),
      reason: "auto-balanced",
    };
  } catch {
    // Concurrent create — read the winner.
    const racy = await db.studyAssignment.findUnique({ where: { userId } });
    if (racy && isArm(racy.arm)) {
      return {
        arm: racy.arm,
        assignedAt: racy.assignedAt.toISOString(),
        reason: racy.reason ?? "auto-balanced",
      };
    }
    return { arm: "control", assignedAt: new Date().toISOString(), reason: "fallback" };
  }
}

/** Operator-only re-assignment (pilot setup; never exposed to participants as self-service). */
export async function assignStudyArm(userId: string, arm: StudyArm): Promise<StudyArmInfo> {
  const existing = await db.studyAssignment.findUnique({ where: { userId } });
  if (existing) {
    const updated = await db.studyAssignment.update({
      where: { userId },
      data: { arm, reason: "operator" },
    });
    return { arm, assignedAt: updated.assignedAt.toISOString(), reason: "operator" };
  }
  const created = await db.studyAssignment.create({
    data: { userId, arm, reason: "operator" },
  });
  return { arm, assignedAt: created.assignedAt.toISOString(), reason: "operator" };
}

/** Bilingual arm descriptions shown in the UI (plan Section 27). */
export const ARM_DESCRIPTIONS: Record<StudyArm, { en: string; ar: string }> = {
  control: {
    en: "Control arm — standard reminders with ML scoring, no extra reminder.",
    ar: "ذراع الضبط — تذكيرات قياسية مع تسجيل درجة المخاطر، دون تذكير إضافي.",
  },
  smart: {
    en: "Smart arm — standard reminders plus an extra reminder for predicted high-risk doses.",
    ar: "ذراع التدخل — تذكيرات قياسية مع تذكير إضافي للجرعات عالية المخاطر المتوقعة.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Research consent gate (v5 review item 42 / addition I).
//
// StudyConsent is the system-of-record for participation: a user's assigned
// arm only takes EFFECT while an active (non-revoked) consent exists.
// getEffectiveStudyArm is the gate every study-data consumer should use —
// it never throws and never auto-assigns anything for non-consented users.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsentInfo {
  version: string;
  grantedAt: string;
  revokedAt: string | null;
}

export interface EffectiveStudyArmInfo {
  arm: StudyArm;
  /** "consented" = active consent, arm as assigned; "no-consent" = forced control. */
  reason: "consented" | "no-consent";
  assignedAt: string | null;
  consent: { version: string; grantedAt: string } | null;
}

/** Active consent row for the user (present AND revokedAt is null); never throws. */
export async function getActiveConsent(userId: string): Promise<ConsentInfo | null> {
  try {
    const row = await db.studyConsent.findUnique({ where: { userId } });
    if (!row || row.revokedAt) return null;
    return {
      version: row.version,
      grantedAt: row.grantedAt.toISOString(),
      revokedAt: null,
    };
  } catch (err) {
    console.error("[study] consent lookup failed:", (err as Error).message);
    return null;
  }
}

/** Serialize any consent row (active or revoked) for API responses. */
export function serializeStudyConsent(row: {
  version: string;
  grantedAt: Date;
  revokedAt: Date | null;
}): ConsentInfo {
  return {
    version: row.version,
    grantedAt: row.grantedAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

/**
 * Consent-gated study arm (v5 review item 42/I):
 *
 *   active consent  → the ASSIGNED arm (existing StudyAssignment mechanism —
 *                     getStudyArm still auto-balances on first lookup);
 *   no consent      → "control" with reason "no-consent" and NO side effects
 *                     (a non-consenting user is never auto-assigned here).
 *
 * Never throws — the gate must not take the reminder engine down.
 */
export async function getEffectiveStudyArm(userId: string): Promise<EffectiveStudyArmInfo> {
  const consent = await getActiveConsent(userId);
  if (!consent) {
    return { arm: "control", reason: "no-consent", assignedAt: null, consent: null };
  }
  try {
    const info = await getStudyArm(userId);
    return {
      arm: info.arm,
      reason: "consented",
      assignedAt: info.assignedAt,
      consent: { version: consent.version, grantedAt: consent.grantedAt },
    };
  } catch (err) {
    console.error("[study] effective-arm lookup failed:", (err as Error).message);
    return { arm: "control", reason: "no-consent", assignedAt: null, consent: null };
  }
}
