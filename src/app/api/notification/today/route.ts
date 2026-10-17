/** POST /api/notification/today — port of getTodaysNotificationsHandler.
 * Phase 12: auth-only (the caller's own notifications). */
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { getTodaysNotifications } from "@/lib/server/notifications";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const data = await getTodaysNotifications(guard.id);
    return json({ success: true, message: "Today notifications fetched", data });
  } catch (err) {
    console.error("Error in getTodaysNotificationsHandler:", err);
    return json({ success: false, message: "Server error" }, 500);
  }
}

export const POST = withMetrics("POST /api/notification/today", handler_POST);
