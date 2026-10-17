/**
 * PUT /api/preferences/timezone — Phase 3 write path for the user's timezone.
 *
 * Body: { timeZone: "Asia/Hebron" } (IANA name, validated server-side).
 * Applies safely through applyUserTimeZone: future pending scheduler rows
 * are rebuilt in the new zone; history is never rewritten.
 */
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { applyUserTimeZone } from "@/lib/server/user-timezone";
import { getUserTimeZone } from "@/lib/server/tz";
import { withMetrics } from "@/lib/server/metrics";

export const GET = withMetrics("GET /api/preferences/timezone", async (req: Request) => {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const timeZone = await getUserTimeZone(guard.id);
  return json({ success: true, timeZone });
});

export const PUT = withMetrics("PUT /api/preferences/timezone", async (req: Request) => {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const body = await readJson<{ timeZone?: string }>(req);
  if (!body.timeZone || typeof body.timeZone !== "string") {
    return json(
      { success: false, message: "Missing timeZone (IANA name, e.g. Asia/Hebron)" },
      400
    );
  }

  try {
    const result = await applyUserTimeZone(guard.id, body.timeZone);
    if (!result.changed && result.timeZone !== body.timeZone.trim()) {
      return json({ success: false, message: "Invalid timezone name" }, 400);
    }
    return json({
      success: true,
      timeZone: result.timeZone,
      changed: result.changed,
      message: result.changed
        ? `Timezone set to ${result.timeZone} — upcoming doses were rescheduled to your local clock.`
        : `Timezone already set to ${result.timeZone}.`,
    });
  } catch (err) {
    console.error("[preferences/timezone] failed:", err);
    return json({ success: false, message: "Failed to update timezone" }, 500);
  }
});
