/**
 * GET/PUT /api/preferences — port of api/preferencesController.js.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
// MR-1 central fix (2026-10-01): getAuthUser → requireSelf so these routes
// also enforce account state + tokenVersion (session invalidation).
import { requireSelf } from "@/lib/server/jwt";

function shape(user: {
  preferredLanguage: string | null;
  autoTranslateAll: boolean | null;
  showReadabilityScores: boolean | null;
  targetReadingLevel: string | null;
}) {
  return {
    preferredLanguage: user.preferredLanguage || "en",
    autoTranslateAll: user.autoTranslateAll || false,
    showReadabilityScores: user.showReadabilityScores !== false,
    targetReadingLevel: user.targetReadingLevel || "highschool",
  };
}

export async function GET(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const user = await db.user.findUnique({ where: { id: guard.id } });
    if (!user) return json({ error: "User not found" }, 404);

    return json({ preferences: shape(user) });
  } catch (error) {
    console.error("getUserPreferences error:", (error as Error).message);
    return json({ error: "Failed to fetch user preferences" }, 500);
  }
}

export async function PUT(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const body = await readJson<Record<string, unknown>>(req);
    const updates: Record<string, unknown> = {};
    const allowedFields = ["preferredLanguage", "autoTranslateAll", "showReadabilityScores", "targetReadingLevel"];

    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }

    if (updates.preferredLanguage) {
      const validLanguages = ["en", "ar"];
      if (!validLanguages.includes(updates.preferredLanguage as string)) {
        return json({ error: "Invalid language code" }, 400);
      }
    }
    if (updates.targetReadingLevel) {
      const validLevels = ["all", "college", "highschool", "middle", "elementary"];
      if (!validLevels.includes(updates.targetReadingLevel as string)) {
        return json({ error: "Invalid reading level" }, 400);
      }
    }

    const updated = await db.user.update({ where: { id: guard.id }, data: updates });
    return json({ success: true, preferences: shape(updated) });
  } catch (error) {
    console.error("updateUserPreferences error:", (error as Error).message);
    return json({ error: "Failed to update user preferences" }, 500);
  }
}
