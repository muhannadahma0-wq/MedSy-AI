/**
 * POST /api/translate — port of api/translationController.js (translate).
 * Handles single text and batch (texts[]) in one route, like the original.
 * Sandbox fix: returns translatedText as a plain string (the original
 * controller leaked the service's { success, translatedText } object).
 */
import { json, readJson } from "@/lib/server/http";
import translationService from "@/lib/server/translation";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const { text, texts, targetLanguage, context = "medical" } = await readJson<{
      text?: string;
      texts?: string[];
      targetLanguage?: string;
      context?: string;
    }>(req);

    if (!text && (!texts || !Array.isArray(texts))) {
      return json({ error: "Provide 'text' or an array 'texts' to translate" }, 400);
    }

    const targetLang = targetLanguage || process.env.DEFAULT_LANGUAGE || "en";

    if (texts && Array.isArray(texts)) {
      const translated = await translationService.translateBatch(texts, targetLang, context);
      const detected = await translationService.detectLanguage(texts[0] || "");
      return json({
        translatedTexts: translated,
        targetLanguage: targetLang,
        originalLanguage: detected,
      });
    }

    const detectedLanguage = await translationService.detectLanguage(text || "");
    const result = await translationService.translateText(text || "", targetLang, context);

    return json({
      translatedText: typeof result === "string" ? result : result.translatedText,
      targetLanguage: targetLang,
      originalLanguage: detectedLanguage,
    });
  } catch (error) {
    console.error("Translation error:", (error as Error).message);
    return json({ error: "Translation failed" }, 500);
  }
}

export const POST = withMetrics("POST /api/translate", handler_POST);
