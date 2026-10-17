/** POST /api/translate/batch — same handler as /api/translate (as in the original). */
import { json, readJson } from "@/lib/server/http";
import translationService from "@/lib/server/translation";

export async function POST(req: Request) {
  try {
    const { texts, targetLanguage, context = "medical" } = await readJson<{
      texts?: string[];
      targetLanguage?: string;
      context?: string;
    }>(req);

    if (!texts || !Array.isArray(texts)) {
      return json({ error: "Provide an array 'texts' to translate" }, 400);
    }

    const targetLang = targetLanguage || process.env.DEFAULT_LANGUAGE || "en";
    const translated = await translationService.translateBatch(texts, targetLang, context);
    const detected = await translationService.detectLanguage(texts[0] || "");

    return json({
      translatedTexts: translated,
      targetLanguage: targetLang,
      originalLanguage: detected,
    });
  } catch (error) {
    console.error("Translation error:", (error as Error).message);
    return json({ error: "Translation failed" }, 500);
  }
}
