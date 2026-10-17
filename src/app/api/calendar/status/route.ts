/**
 * POST /api/calendar/status — port of calendarSyncController.js
 * (getCalendarSyncStatus). Without Google tokens the user is simply not
 * linked, which is the original's own no-tokens path.
 */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
// MR-1 central fix (2026-10-01): getAuthUser → requireSelf (state + tokenVersion).
import { requireSelf } from "@/lib/server/jwt";

export async function POST(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const user = await db.user.findUnique({ where: { id: guard.id } });
    if (!user) return json({ success: false, message: "User not found" }, 404);

    const hasTokens = Boolean(user.googleTokens);
    return json({
      success: true,
      isLinked: hasTokens,
      syncEnabled: hasTokens ? user.calendarSyncEnabled : false,
      lastSync: user.lastCalendarSync,
    });
  } catch (err) {
    console.error("Error checking sync status:", err);
    return json({ success: false, message: "Error verifying calendar" }, 500);
  }
}
