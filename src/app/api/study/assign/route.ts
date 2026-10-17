/**
 * POST /api/study/assign — OPERATOR endpoint (plan §28).
 *
 * This is researcher/pilot-setup tooling: it re-assigns a participant's study
 * arm. Participants NEVER self-select an arm — arm changes are made by the
 * study operator during pilot setup only, and the reason is recorded as
 * "operator" in the StudyAssignment row. Body:
 *
 *   { userId?: string, arm: "control" | "smart" }
 *
 * Phase 12: authenticated callers only; an explicit body userId may only
 * ever be the caller's own (a real multi-operator deployment would add a
 * role check — documented in SECURITY_ASSESSMENT.md).
 */
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { assignStudyArm, type StudyArm } from "@/lib/server/study";

function isArm(value: unknown): value is StudyArm {
  return value === "control" || value === "smart";
}

interface AssignBody {
  userId?: string;
  arm?: string;
}

export const POST = withMetrics("POST /api/study/assign", async (req: Request) => {
  const body = await readJson<AssignBody>(req);

  const guard = await requireSelf(req, body?.userId ?? null);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  if (!isArm(body.arm)) {
    return json(
      { success: false, message: 'Invalid arm — must be "control" or "smart"' },
      400
    );
  }

  const info = await assignStudyArm(userId, body.arm);
  return json({ success: true, ...info });
});
