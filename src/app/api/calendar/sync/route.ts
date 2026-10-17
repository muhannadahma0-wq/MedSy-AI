/**
 * POST /api/calendar/sync — port of calendarSyncController.js
 * (syncMedicationsToCalendar). Same "not linked" response as the original
 * when the user has no Google tokens.
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

    if (!user.googleTokens) {
      return json(
        {
          success: false,
          message: "Google Calendar not linked. Please connect your calendar first.",
        },
        400
      );
    }

    // With tokens present the original would sync via the Google Calendar API;
    // unreachable in this sandbox (no credentials), so report the same shape.
    return json(
      {
        success: false,
        message: "Google Calendar credentials are not configured in this environment.",
      },
      400
    );
  } catch (err) {
    console.error("Calendar sync error:", err);
    return json({ success: false, message: "Error syncing calendar" }, 500);
  }
}
