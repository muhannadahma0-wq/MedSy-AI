/** POST /api/preferences/reset — port of resetUserPreferences. */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
// MR-1 central fix (2026-10-01): getAuthUser → requireSelf (state + tokenVersion).
import { requireSelf } from "@/lib/server/jwt";

export async function POST(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const updated = await db.user.update({
      where: { id: guard.id },
      data: {
        preferredLanguage: "en",
        autoTranslateAll: false,
        showReadabilityScores: true,
        targetReadingLevel: "highschool",
      },
    });

    return json({
      success: true,
      message: "Preferences reset to defaults",
      preferences: {
        preferredLanguage: updated.preferredLanguage,
        autoTranslateAll: updated.autoTranslateAll,
        showReadabilityScores: updated.showReadabilityScores,
        targetReadingLevel: updated.targetReadingLevel,
      },
    });
  } catch (error) {
    console.error("resetUserPreferences error:", (error as Error).message);
    return json({ error: "Failed to reset user preferences" }, 500);
  }
}
