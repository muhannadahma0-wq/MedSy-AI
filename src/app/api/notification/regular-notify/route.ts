/**
 * POST /api/notification/regular-notify — port of notificationRoutes.js.
 *
 * MEDSYNC-004: now triggers the UNIFIED reminder engine for the logged-in
 * user instead of the legacy in-memory setTimeout scheduler. The response
 * contract is preserved ({ success, message, scheduled }) so the original
 * client keeps working unchanged.
 * Phase 12: auth-only (the caller's own engine tick).
 */
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { runEngineTick } from "@/lib/server/reminder-engine";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const summary = await runEngineTick([guard.id]);
  return json({
    success: true,
    message: "Unified reminder engine tick completed",
    scheduled: summary.planned,
    mode: summary.mode,
    summary,
  });
}

export const POST = withMetrics("POST /api/notification/regular-notify", handler_POST);
