/**
 * MEDSYNC controlled-study statistics (plan §30–31) — PURE functions only.
 * No database imports, no side effects: every number produced here can be
 * audited (and hand-checked against a textbook) independently of Prisma.
 *
 *   wilsonInterval     Wilson score interval for a single proportion.
 *   newcombeDifference Newcombe hybrid-score interval (method 10) for the
 *                      difference of two independent proportions — the
 *                      recommended small/unbalanced-sample CI, which is
 *                      exactly the pilot-study situation.
 *   ArmOutcomeAggregate / deriveArmOutcomes  per-arm raw counts (filled in
 *                      by the routes) → derived, response-shaped outcomes.
 *
 * Semantics (adherence-engine contract):
 *   confirmed  = taken | delayed          (the dose was eventually taken)
 *   on-time    = taken
 *   unconfirmed = missed                  (never conflated with delayed)
 *   resolved   = taken | delayed | missed (study §30: pending & skipped are
 *               excluded so the rate denominators contain only final outcomes)
 *
 * All exported numeric results are rounded to 4 decimals.
 */

export interface WilsonInterval {
  lo: number;
  hi: number;
}

export interface DifferenceInterval {
  diff: number; // p1 − p2
  lo: number;
  hi: number;
}

/** Round to 4 decimals — every rate / mean / CI bound leaving this module. */
export function round4(x: number): number {
  return Number(x.toFixed(4));
}

/** Unrounded Wilson bounds (internal, so Newcombe never compounds rounding). */
function wilsonBounds(k: number, n: number, z: number): WilsonInterval {
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

/**
 * Wilson score interval for the proportion k/n (default z = 1.96 → 95%).
 * Returns null when n = 0 — an empty sample gets NO interval, never 0–0.
 */
export function wilsonInterval(k: number, n: number, z = 1.96): WilsonInterval | null {
  if (n <= 0) return null;
  const b = wilsonBounds(k, n, z);
  return { lo: round4(b.lo), hi: round4(b.hi) };
}

/**
 * Newcombe hybrid-score interval (method 10) for p1 − p2:
 *
 *   lower = diff − sqrt((p1 − l1)² + (u2 − p2)²)
 *   upper = diff + sqrt((u1 − p1)² + (p2 − l2)²)
 *
 * where (l1,u1), (l2,u2) are the Wilson bounds of each proportion: each arm
 * contributes the distance from its own proportion to its own bound, so the
 * interval stays honest when one arm is near 0 or 1 (unlike the Wald CI).
 * Returns null when either sample is empty.
 */
export function newcombeDifference(
  k1: number,
  n1: number,
  k2: number,
  n2: number
): DifferenceInterval | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const w1 = wilsonBounds(k1, n1, 1.96);
  const w2 = wilsonBounds(k2, n2, 1.96);
  const diff = p1 - p2;
  return {
    diff: round4(diff),
    lo: round4(diff - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2)),
    hi: round4(diff + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-arm aggregates — the routes count raw rows into these, then hand them
// to deriveArmOutcomes() for every derived rate. Keeping counts and rates in
// separate pure steps makes the arithmetic reviewable at a glance.
// ─────────────────────────────────────────────────────────────────────────────

/** Raw per-arm counts computed from DoseEvent + SmartReminder rows. */
export interface ArmOutcomeAggregate {
  /** Resolved (taken|delayed|missed) doses with riskLevel === "high" — primary denominator. */
  highRiskTotal: number;
  /** Of those, confirmed (taken|delayed). */
  highRiskConfirmed: number;
  /** taken + delayed + missed (pending & skipped excluded — §30). */
  resolvedTotal: number;
  /** taken + delayed. */
  confirmedTotal: number;
  /** taken only — the on-time numerator (adherence-engine convention: taken / confirmed). */
  takenTotal: number;
  /** missed only. */
  missedTotal: number;
  /** User-initiated skips — tracked separately, never inside "resolved". */
  skippedTotal: number;
  /** Σ delayMinutes over confirmed doses with delayMinutes ≠ null. */
  delaySumMinutes: number;
  /** Count of confirmed doses with delayMinutes ≠ null. */
  delayCount: number;
  /** (actualAt − reminder.sentAt) in minutes, one entry per (confirmed event, sent non-snooze reminder ≤ actualAt) pair. */
  responseTimes: number[];
  /** SmartReminders with type === "extra" AND status === "sent" — must be 0 for control (§27). */
  extraExposure: number;
  /** SmartReminders with type === "snooze". */
  snoozeCount: number;
}

export function emptyArmAggregate(): ArmOutcomeAggregate {
  return {
    highRiskTotal: 0,
    highRiskConfirmed: 0,
    resolvedTotal: 0,
    confirmedTotal: 0,
    takenTotal: 0,
    missedTotal: 0,
    skippedTotal: 0,
    delaySumMinutes: 0,
    delayCount: 0,
    responseTimes: [],
    extraExposure: 0,
    snoozeCount: 0,
  };
}

/** Primary endpoint block: unconfirmed rate among resolved high-risk doses. */
export interface ArmHighRiskOutcome {
  /** Resolved high-risk doses (denominator). */
  n: number;
  /** Confirmed (taken|delayed) among them. */
  confirmed: number;
  /** (n − confirmed) / n — null when n = 0. */
  unconfirmedRate: number | null;
  /** Wilson score 95% CI on unconfirmedRate — null when n = 0. */
  wilson95: WilsonInterval | null;
}

/** Secondary endpoints (plan §31). */
export interface ArmSecondaryOutcomes {
  resolvedTotal: number;
  confirmedTotal: number;
  takenTotal: number;
  delayedTotal: number;
  missedTotal: number;
  skippedTotal: number;
  /** confirmed / resolved — null when resolvedTotal = 0. */
  confirmedRate: number | null;
  /** taken / confirmed — null when confirmedTotal = 0. */
  onTimeRate: number | null;
  /** Mean delayMinutes over confirmed doses with delayMinutes ≠ null — null when delayCount = 0. */
  avgDelayMinutes: number | null;
  /** skipped / (resolved + skipped) — null when both are 0. */
  skippedRate: number | null;
  /** EXTRA reminders actually SENT to this arm (control must be 0). */
  extraExposure: number;
  snoozeCount: number;
  /** Mean of responseTimes (minutes) — null when no qualifying (event, reminder) pairs. */
  reminderResponseMinutes: number | null;
}

export interface ArmOutcomeResult {
  highRisk: ArmHighRiskOutcome;
  secondary: ArmSecondaryOutcomes;
}

/** Derive every reported rate from the raw counts (pure, rounded to 4 decimals). */
export function deriveArmOutcomes(agg: ArmOutcomeAggregate): ArmOutcomeResult {
  const highRiskUnconfirmed = agg.highRiskTotal - agg.highRiskConfirmed;
  return {
    highRisk: {
      n: agg.highRiskTotal,
      confirmed: agg.highRiskConfirmed,
      unconfirmedRate: agg.highRiskTotal > 0 ? round4(highRiskUnconfirmed / agg.highRiskTotal) : null,
      wilson95: wilsonInterval(highRiskUnconfirmed, agg.highRiskTotal),
    },
    secondary: {
      resolvedTotal: agg.resolvedTotal,
      confirmedTotal: agg.confirmedTotal,
      takenTotal: agg.takenTotal,
      delayedTotal: agg.confirmedTotal - agg.takenTotal,
      missedTotal: agg.missedTotal,
      skippedTotal: agg.skippedTotal,
      confirmedRate: agg.resolvedTotal > 0 ? round4(agg.confirmedTotal / agg.resolvedTotal) : null,
      onTimeRate: agg.confirmedTotal > 0 ? round4(agg.takenTotal / agg.confirmedTotal) : null,
      avgDelayMinutes:
        agg.delayCount > 0 ? round4(agg.delaySumMinutes / agg.delayCount) : null,
      skippedRate:
        agg.resolvedTotal + agg.skippedTotal > 0
          ? round4(agg.skippedTotal / (agg.resolvedTotal + agg.skippedTotal))
          : null,
      extraExposure: agg.extraExposure,
      snoozeCount: agg.snoozeCount,
      reminderResponseMinutes:
        agg.responseTimes.length > 0
          ? round4(agg.responseTimes.reduce((a, b) => a + b, 0) / agg.responseTimes.length)
          : null,
    },
  };
}
