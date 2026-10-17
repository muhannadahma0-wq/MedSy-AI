/**
 * GET /api/study/outcomes — arm-level outcome analysis with 95% CIs
 * (plan §30 primary/secondary endpoints + §31 estimation rules).
 *
 * Computes across EVERY user that has a StudyAssignment so the researcher
 * view works. Only arm-level aggregates are returned — no per-participant
 * data leaves this route — so the analysis is not scoped and not gated.
 * The shared auth fallback (Bearer / ?userId=) is still honored: when a
 * requesting user is resolvable their arm is echoed read-only as `viewerArm`
 * (never auto-enrolled by this researcher endpoint).
 *
 * Semantics (adherence-engine contract, §30):
 *   confirmed   = taken | delayed   → primary outcome "was the dose
 *   unconfirmed = missed               eventually taken?"
 *   resolved    = taken | delayed | missed (pending & skipped EXCLUDED from
 *                 rate denominators; skipped is a separate user action)
 * Primary endpoint: unconfirmed rate among resolved HIGH-RISK doses,
 * difference smart − control with a Newcombe hybrid-score 95% CI (method 10).
 * Integrity guard: the control arm must show extraExposure === 0 — the EXTRA
 * reminder is withheld from control by the engine (§27), and this endpoint
 * verifies it against the actual SmartReminder ledger rather than trusting it.
 */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { getEngineMode } from "@/lib/server/reminder-engine";
import type { StudyArm } from "@/lib/server/study";
import {
  deriveArmOutcomes,
  emptyArmAggregate,
  newcombeDifference,
  round4,
  type ArmOutcomeAggregate,
  type ArmOutcomeResult,
} from "@/lib/server/study-stats";

const DISCLAIMER_STUDY_EN =
  "Demo/single-participant behavioural data — illustrative only. NOT clinical evidence and not medical advice (plan §18).";
const DISCLAIMER_STUDY_AR =
  "بيانات سلوكية تجريبية من مشارك واحد — لأغراض التوضيح فقط، وليست دليلاً طبياً ولا نصيحة طبية (الخطة §18).";

interface ReminderLite {
  doseEventId: string;
  type: string;
  status: string;
  sentAt: Date | null;
}

interface ArmBundle {
  users: string[];
  outcomes: ArmOutcomeResult;
  predictions: number;
}

async function computeArm(userIds: string[]): Promise<ArmBundle> {
  const aggregate: ArmOutcomeAggregate = emptyArmAggregate();
  if (userIds.length === 0) {
    return { users: userIds, outcomes: deriveArmOutcomes(aggregate), predictions: 0 };
  }

  const [events, reminders, predictions] = await Promise.all([
    db.doseEvent.findMany({ where: { userId: { in: userIds } } }),
    db.smartReminder.findMany({ where: { userId: { in: userIds } } }),
    db.riskPrediction.count({ where: { userId: { in: userIds } } }),
  ]);

  const liteReminders: ReminderLite[] = reminders.map((r) => ({
    doseEventId: r.doseEventId,
    type: r.type,
    status: r.status,
    sentAt: r.sentAt,
  }));
  const remindersByEvent = new Map<string, ReminderLite[]>();
  for (const r of liteReminders) {
    const list = remindersByEvent.get(r.doseEventId) ?? [];
    list.push(r);
    remindersByEvent.set(r.doseEventId, list);
  }

  for (const e of events) {
    const status = e.status;
    const confirmed = status === "taken" || status === "delayed";
    const resolved = confirmed || status === "missed"; // pending & skipped excluded (§30)

    if (status === "skipped") aggregate.skippedTotal++;
    if (status === "taken") aggregate.takenTotal++;
    if (status === "missed") aggregate.missedTotal++;
    if (resolved) aggregate.resolvedTotal++;
    if (confirmed) {
      aggregate.confirmedTotal++;
      if (e.delayMinutes !== null) {
        aggregate.delaySumMinutes += e.delayMinutes;
        aggregate.delayCount++;
      }
    }
    if (e.riskLevel === "high" && resolved) {
      aggregate.highRiskTotal++;
      if (confirmed) aggregate.highRiskConfirmed++;
    }
    // Reminder response: (actualAt − sentAt) for every SENT non-snooze
    // reminder that fired at or before the confirmation — pair-based mean.
    if (confirmed && e.actualAt) {
      for (const r of remindersByEvent.get(e.id) ?? []) {
        if (r.type !== "snooze" && r.status === "sent" && r.sentAt && r.sentAt.getTime() <= e.actualAt.getTime()) {
          aggregate.responseTimes.push((e.actualAt.getTime() - r.sentAt.getTime()) / 60_000);
        }
      }
    }
  }

  for (const r of liteReminders) {
    if (r.type === "extra" && r.status === "sent") aggregate.extraExposure++;
    if (r.type === "snooze") aggregate.snoozeCount++;
  }

  return { users: userIds, outcomes: deriveArmOutcomes(aggregate), predictions };
}

interface DifferenceBlock {
  value: number | null;
  ci95: { lo: number; hi: number } | null;
  estimable: boolean;
  reason: string;
}

export const GET = withMetrics("GET /api/study/outcomes", async (req: Request) => {
  // Phase 12 — BOLA guard: outcomes are aggregated, but the viewer's own arm
  // echo requires authentication (the ?userId= may only be the caller's own).
  const guard = await requireSelf(req, new URL(req.url).searchParams.get("userId"));
  if (guard instanceof Response) return guard;
  const requesterId = guard.id;

  const assignments = await db.studyAssignment.findMany();
  const byArm: Record<StudyArm, string[]> = { control: [], smart: [] };
  for (const a of assignments) {
    if (a.arm === "control" || a.arm === "smart") byArm[a.arm].push(a.userId);
  }

  // Read-only echo of the requesting user's arm (no auto-enrollment here).
  const viewerAssignment = requesterId
    ? await db.studyAssignment.findUnique({ where: { userId: requesterId } })
    : null;
  const viewerArm: StudyArm | null =
    viewerAssignment && (viewerAssignment.arm === "control" || viewerAssignment.arm === "smart")
      ? viewerAssignment.arm
      : null;

  const [control, smart] = await Promise.all([computeArm(byArm.control), computeArm(byArm.smart)]);

  // Primary difference: smart − control unconfirmed rate, Newcombe 95% CI.
  const controlN = control.outcomes.highRisk.n;
  const smartN = smart.outcomes.highRisk.n;
  const controlUnconfirmed = controlN - control.outcomes.highRisk.confirmed;
  const smartUnconfirmed = smartN - smart.outcomes.highRisk.confirmed;
  const controlRate = controlN > 0 ? controlUnconfirmed / controlN : null;
  const smartRate = smartN > 0 ? smartUnconfirmed / smartN : null;

  let difference: DifferenceBlock;
  if (controlN === 0 || smartN === 0) {
    const emptyArms = [controlN === 0 ? "control" : null, smartN === 0 ? "smart" : null]
      .filter((a): a is string => a !== null)
      .join(" and ");
    const armsVerb = emptyArms.includes(" and ") ? "arms have" : "arm has";
    difference = {
      value: null,
      ci95: null,
      estimable: false,
      reason: `Not estimable: the ${emptyArms} ${armsVerb} 0 resolved high-risk doses — the primary endpoint needs resolved high-risk doses in BOTH arms.`,
    };
  } else {
    const ci = newcombeDifference(smartUnconfirmed, smartN, controlUnconfirmed, controlN);
    difference = {
      value: controlRate !== null && smartRate !== null ? round4(smartRate - controlRate) : null,
      ci95: ci ? { lo: ci.lo, hi: ci.hi } : null,
      estimable: ci !== null,
      reason:
        "Difference (smart − control) in high-risk unconfirmed rate with a Newcombe hybrid-score 95% CI (method 10).",
    };
  }

  return json({
    success: true,
    generatedAt: new Date().toISOString(),
    engineMode: getEngineMode(),
    viewerArm,
    primaryOutcome: {
      metric: "high-risk unconfirmed rate",
      control: control.outcomes.highRisk,
      smart: smart.outcomes.highRisk,
      difference,
    },
    secondaryOutcomes: {
      control: { users: control.users.length, ...control.outcomes.secondary },
      smart: { users: smart.users.length, ...smart.outcomes.secondary },
    },
    integrity: {
      controlExtraSent: control.outcomes.secondary.extraExposure,
      note: "Control arm must never receive EXTRA reminders",
    },
    disclaimer: { en: DISCLAIMER_STUDY_EN, ar: DISCLAIMER_STUDY_AR },
    modelAvailability: {
      control: control.predictions,
      smart: smart.predictions,
    },
  });
});
