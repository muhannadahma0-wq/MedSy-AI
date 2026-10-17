/**
 * GET /api/study/status — a participant's controlled-study arm + study-wide
 * enrollment snapshot (plan §27–28).
 *
 * Phase 12: the ?userId= parameter may only ever be the caller's own id.
 * The arm is resolved through getStudyArm, which auto-assigns a balanced arm
 * on first lookup (participants never self-select — arm changes go through
 * the operator endpoint /api/study/assign).
 */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { getEngineMode } from "@/lib/server/reminder-engine";
import { ARM_DESCRIPTIONS, getStudyArm } from "@/lib/server/study";

export const GET = withMetrics("GET /api/study/status", async (req: Request) => {
  const guard = await requireSelf(req, new URL(req.url).searchParams.get("userId"));
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const info = await getStudyArm(userId);

  // Study-wide enrollment: one row per StudyAssignment, grouped by arm.
  const groups = await db.studyAssignment.groupBy({ by: ["arm"], _count: { _all: true } });
  const participants = { total: 0, control: 0, smart: 0 };
  for (const g of groups) {
    const count = g._count._all;
    participants.total += count;
    if (g.arm === "control") participants.control += count;
    else if (g.arm === "smart") participants.smart += count;
  }

  return json({
    success: true,
    arm: info.arm,
    assignedAt: info.assignedAt,
    reason: info.reason,
    armDescription: ARM_DESCRIPTIONS[info.arm],
    engineMode: getEngineMode(),
    participants,
  });
});
