/**
 * Port of server/src/services/translationService.js.
 *
 * The original called the Google Translate REST API. That endpoint does
 * not accept API keys of the type shipped with this project, so the
 * translation backend is now Google Gemini via LangChain
 * (ChatGoogleGenerativeAI — the "Gemini" half of the original
 * Groq / Gemini architecture), with a z-ai fallback when Google is
 * unreachable (e.g. region-blocked networks). Everything else is preserved
 * verbatim: the medical-terminology placeholder pipeline
 * (applyMedicalTerminology / restoreMedicalTerms), the in-memory cache with
 * the same key format, retry behaviour, and the
 * { success, translatedText, originalText } contract.
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { zaiComplete } from "./models/zai-fallback";
import { DEFAULT_LANGUAGE } from "./language-config";
import { MEDICAL_TERMS } from "./medical-terminology";

const CACHE_TTL_MS = 86400; // 24h — same default as TRANSLATION_CACHE_TTL

interface CacheEntry {
  value: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ar: "Arabic (Modern Standard Arabic)",
};

// Gemini translation model (own instance + settings)
let geminiModel: ChatGoogleGenerativeAI | null = null;
try {
  if (process.env.GOOGLE_API_KEY) {
    geminiModel = new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      temperature: 0,
      maxRetries: 2,
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }
} catch (error) {
  console.warn("ChatGoogleGenerativeAI initialization failed, translation will use the fallback:", (error as Error).message);
}

/** Invoke the translation LLM: Gemini primary, z-ai fallback. */
async function invokeTranslator(
  messages: { role: "system" | "user"; content: string }[]
): Promise<string> {
  if (geminiModel) {
    try {
      const response = await geminiModel.invoke(messages);
      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);
      if (content.trim().length > 0) {
        return content;
      }
    } catch (err) {
      console.warn(
        `translation: Gemini path failed (${(err as Error).message}); using z-ai fallback.`
      );
    }
  }
  return zaiComplete(messages, { temperature: 0 });
}

class TranslationService {
  maxRetries = 3;
  retryDelay = 1000;

  async translateText(
    text: string,
    targetLang: string = DEFAULT_LANGUAGE,
    context: string = "medical"
  ): Promise<{ success: boolean; translatedText: string; originalText: string; error?: string }> {
    try {
      if (targetLang === DEFAULT_LANGUAGE) {
        return { success: true, translatedText: text, originalText: text };
      }
      if (!text || text.trim().length === 0) {
        return { success: true, translatedText: text, originalText: text };
      }

      const cacheKey = this.getCacheKey(text, targetLang, context);
      const cached = this.getCachedTranslation(cacheKey);
      if (cached) {
        return { success: true, translatedText: cached, originalText: text };
      }

      let translated = await this.callTranslationAPI(text, DEFAULT_LANGUAGE, targetLang, context);
      cache.set(cacheKey, { value: translated, timestamp: Date.now() });
      return { success: true, translatedText: translated, originalText: text };
    } catch (error) {
      console.error(`Translation error to ${targetLang}:`, (error as Error).message);
      return { success: false, translatedText: text, originalText: text, error: (error as Error).message };
    }
  }

  async translateBatch(
    texts: string[] = [],
    targetLang: string | string[] = DEFAULT_LANGUAGE,
    context: string = "medical"
  ): Promise<string[]> {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }
    const filteredTexts = texts.filter(Boolean);
    if (filteredTexts.length === 0) {
      return [];
    }

    if (Array.isArray(targetLang)) {
      const results: string[] = [];
      for (let i = 0; i < texts.length; i++) {
        const lang = targetLang[i] || DEFAULT_LANGUAGE;
        if (lang === DEFAULT_LANGUAGE) {
          results.push(texts[i]);
        } else {
          const result = await this.translateText(texts[i], lang, context);
          results.push(result.translatedText || texts[i]);
        }
      }
      return results;
    }

    if (targetLang === DEFAULT_LANGUAGE) {
      return texts;
    }

    const results: string[] = [];
    for (const text of texts) {
      const result = await this.translateText(text, targetLang, context);
      results.push(result.translatedText || text);
    }
    return results;
  }

  /**
   * Language detection. The original called Google's detect endpoint; here a
   * script heuristic keeps it dependency-free and deterministic
   * (Arabic script block → ar, else en).
   */
  async detectLanguage(text: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      return DEFAULT_LANGUAGE;
    }
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) {
      return "ar";
    }
    return DEFAULT_LANGUAGE;
  }

  getCachedTranslation(key: string): string | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS * 1000) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  invalidateCache(key: string | null = null) {
    if (key) {
      cache.delete(key);
    } else {
      cache.clear();
    }
  }

  getSupportedLanguages() {
    return MEDICAL_TERMS && Object.keys(MEDICAL_TERMS).length
      ? undefined // handled by language-config SUPPORTED_LANGUAGES at route level
      : undefined;
  }

  private async callTranslationAPI(
    text: string,
    sourceLang: string,
    targetLang: string,
    context: string,
    retryCount = 0
  ): Promise<string> {
    try {
      let textToTranslate = text;
      const medicalReplacements: Record<string, string> = {};

      if (context === "medical") {
        const result = this.applyMedicalTerminology(text);
        textToTranslate = result.text;
        Object.assign(medicalReplacements, result.replacements);
      }

      const targetName = LANGUAGE_NAMES[targetLang] || targetLang;
      const translated = await invokeTranslator([
        {
          role: "system",
          content:
            `You are a professional medical translator. Translate the user's text from ${sourceLang === "en" ? "English" : sourceLang} to ${targetName}. ` +
            "This is a " + context + " context: preserve the meaning precisely, keep medication names accurate, and keep the tone natural. " +
            (targetLang === "ar"
              ? "Write in clear Modern Standard Arabic (العربية الفصحى). Keep medication names in both Arabic transliteration and Latin script. "
              : "") +
            "Return ONLY the translated text with no quotes, no explanations, and no preamble.",
        },
        { role: "user", content: textToTranslate },
      ]);

      let cleaned = translated.trim();
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1);
      }
      if (!cleaned) cleaned = text;

      return this.restoreMedicalTerms(cleaned, medicalReplacements);
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.warn(`Translation retry ${retryCount + 1}/${this.maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
        return this.callTranslationAPI(text, sourceLang, targetLang, context, retryCount + 1);
      }
      throw error;
    }
  }

  private applyMedicalTerminology(text: string): { text: string; replacements: Record<string, string> } {
    const replacements: Record<string, string> = {};
    let processedText = text;
    let placeholderIndex = 0;

    Object.keys(MEDICAL_TERMS).forEach((term) => {
      const regex = new RegExp(`\\b${term}\\b`, "gi");
      if (regex.test(processedText)) {
        const placeholder = `__MEDICAL_${placeholderIndex}__`;
        processedText = processedText.replace(regex, placeholder);
        replacements[placeholder] = term;
        placeholderIndex++;
      }
    });

    return { text: processedText, replacements };
  }

  private restoreMedicalTerms(text: string, replacements: Record<string, string>): string {
    let restored = text;
    Object.entries(replacements).forEach(([placeholder, term]) => {
      restored = restored.replace(new RegExp(placeholder, "g"), term);
    });
    return restored;
  }

  private getCacheKey(text: string, targetLang: string, context: string): string {
    return `${context}:${targetLang}:${text.substring(0, 100)}`;
  }
}

const translationService = new TranslationService();
export default translationService;
