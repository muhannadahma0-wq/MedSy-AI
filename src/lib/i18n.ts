/**
 * Bilingual error-code map (v5 review item 51).
 *
 * The backend returns a CLOSED set of stable error codes
 * (src/lib/server/http.ts → apiError / AI_BUDGET_EXCEEDED from the daily
 * agent budget). Raw provider or exception messages never reach the client,
 * so the frontend can map every code to a friendly, localized sentence
 * instead of showing raw English.
 *
 * Usage (in a component that has the active language):
 *   import { errorMessage } from "../lib/i18n";
 *   const { language } = useLanguage();
 *   errorMessage("AI_BUDGET_EXCEEDED", data?.error?.message, language)
 *
 * Unknown codes fall back to `fallback` (the server message) and, when that
 * is missing too, to a generic bilingual-safe default. Pages that do not own
 * this file yet can adopt the helper incrementally — nothing here changes
 * existing behavior.
 */

export type ErrorMessageLang = "ar" | "en";

/** code → { en, ar } — every code the backend can emit today. */
export const ERROR_MESSAGES: Record<string, { en: string; ar: string }> = {
  // Daily per-user/per-agent AI request budget (429 — see gateway budget).
  AI_BUDGET_EXCEEDED: {
    en: "You reached the daily question limit for this agent. It resets at midnight UTC — the emergency agent is never limited.",
    ar: "لقد وصلت إلى الحد اليومي للأسئلة لهذا الوكيل. يُعاد ضبطه عند منتصف الليل بتوقيت UTC — وكيل الطوارئ غير مقيَّد أبداً.",
  },
  RATE_LIMITED: {
    en: "Too many requests — please wait a moment and try again.",
    ar: "طلبات كثيرة جداً — انتظر لحظة ثم حاول مرة أخرى.",
  },
  VALIDATION_ERROR: {
    en: "Some of the information you entered is invalid. Please check it and try again.",
    ar: "بعض المعلومات التي أدخلتها غير صالحة. تحقق منها ثم حاول مرة أخرى.",
  },
  UNAUTHORIZED: {
    en: "Please sign in to continue.",
    ar: "يرجى تسجيل الدخول للمتابعة.",
  },
  FORBIDDEN: {
    en: "You don't have permission to perform this action.",
    ar: "ليست لديك صلاحية تنفيذ هذا الإجراء.",
  },
  NOT_FOUND: {
    en: "The requested item was not found.",
    ar: "لم يتم العثور على العنصر المطلوب.",
  },
  SESSION_INVALIDATED: {
    en: "Your session was signed out on another device — please sign in again.",
    ar: "تم تسجيل خروج جلستك من جهاز آخر — يرجى تسجيل الدخول مجدداً.",
  },
  ACCOUNT_DISABLED: {
    en: "This account has been disabled. Please contact support for help.",
    ar: "تم تعطيل هذا الحساب. يرجى التواصل مع الدعم للمساعدة.",
  },
  INTERNAL_ERROR: {
    en: "Something went wrong on our side. Please try again.",
    ar: "حدث خطأ من جهتنا. حاول مرة أخرى.",
  },
  MODEL_UNAVAILABLE: {
    en: "The AI service is temporarily unavailable. Please try again shortly.",
    ar: "خدمة الذكاء الاصطناعي غير متاحة مؤقتاً. حاول مرة أخرى بعد قليل.",
  },
  REQUEST_TIMEOUT: {
    en: "The request took too long. Please try again.",
    ar: "استغرق الطلب وقتاً طويلاً. حاول مرة أخرى.",
  },
  SAFETY_BLOCKED: {
    en: "This request was blocked by our safety filters. Please rephrase your question or consult a healthcare professional.",
    ar: "تم حظر هذا الطلب بواسطة مرشّحات الأمان. أعد صياغة سؤالك أو استشر أحد مقدّمي الرعاية الصحية.",
  },
  PAYLOAD_TOO_LARGE: {
    en: "The uploaded file is too large.",
    ar: "حجم الملف المرفوع كبير جداً.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    en: "This file type is not supported.",
    ar: "نوع الملف هذا غير مدعوم.",
  },
};

/** Generic fallback used when neither the code nor `fallback` is usable. */
const GENERIC_FALLBACK: Record<ErrorMessageLang, string> = {
  en: "Something went wrong. Please try again.",
  ar: "حدث خطأ ما. حاول مرة أخرى.",
};

/**
 * Resolve an API error code to a localized, user-friendly message.
 *
 * @param code     stable error code from the API error body (data.error.code)
 * @param fallback optional raw server message — used only for unknown codes
 * @param lang     "ar" | "en" (the active UI language)
 */
export function errorMessage(
  code: string | null | undefined,
  fallback?: string | null,
  lang: ErrorMessageLang = "en"
): string {
  const target = lang === "ar" ? "ar" : "en";
  const entry = code ? ERROR_MESSAGES[code] : undefined;
  if (entry) return entry[target];
  if (fallback && fallback.trim().length > 0) return fallback;
  return GENERIC_FALLBACK[target];
}
