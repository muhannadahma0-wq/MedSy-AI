/**
 * POST /api/reminder-engine/tick — manual trigger for the unified reminder
 * engine (MEDSYNC-004). Body { userId? } scopes the tick to one user;
 * omitted = all users. Returns the tick summary (shadow/live aware).
 */
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { runEngineTick } from "@/lib/server/reminder-engine";
import { withMetrics } from "@/lib/server/metrics";

export const POST = withMetrics("POST /api/reminder-engine/tick", async (req: Request) => {
  const body = await readJson<{ userId?: string; all?: boolean }>(req).catch(() => ({}));

  // Phase 12 — auth-only trigger (idempotent, shadow-aware). The body userId
  // may only ever scope to the caller's own tick; { all: true } runs the
  // global loop (same operation the 60s background tick performs).
  const guard = await requireSelf(req, body?.userId ?? null);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  let userIds: string[] | undefined = [userId];
  if (body?.all === true) {
    userIds = undefined; // all users
  }

  try {
    const summary = await runEngineTick(userIds);
    return json({ success: true, summary });
  } catch (err) {
    console.error("[reminder-engine/tick] failed:", err);
    return json({ success: false, message: "Engine tick failed" }, 500);
  }
});
