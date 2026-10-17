/**
 * GET/PUT /api/languages/user — port of api/languageController.js.
 * Phase 12: auth-only (the caller's own language), no body-id fallback.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { SUPPORTED_LANGUAGES, LANGUAGE_CODES } from "@/lib/server/language-config";

export async function GET(req: Request) {
  try {
    const body = await readJson(req);
    const guard = await requireSelf(req, (body.userId as string) || null);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return json({ error: "User not found" }, 404);

    // Bilingual build — legacy es/hi preferences fall back to English
    const preferred =
      user.preferredLanguage === "ar" || user.preferredLanguage === "en"
        ? user.preferredLanguage
        : "en";

    return json({
      preferredLanguage: preferred,
      supportedLanguages: SUPPORTED_LANGUAGES,
    });
  } catch (error) {
    console.error("getUserLanguage error:", (error as Error).message);
    return json({ error: "Failed to fetch user language" }, 500);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await readJson<{ language?: string; preferredLanguage?: string; userId?: string }>(req);
    const guard = await requireSelf(req, body.userId || null);
    if (guard instanceof Response) return guard;
    const userId = guard.id;
    const language = body.language || body.preferredLanguage;

    if (!language || !LANGUAGE_CODES.includes(language)) {
      return json({ error: "Unsupported or missing language code" }, 400);
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: { preferredLanguage: language },
    });

    return json({ success: true, preferredLanguage: updated.preferredLanguage });
  } catch (error) {
    console.error("updateUserLanguage error:", (error as Error).message);
    return json({ error: "Failed to update user language" }, 500);
  }
}
