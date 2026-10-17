/**
 * Language configuration for the bilingual (English / Arabic) build.
 * The app supports exactly two languages — English (LTR) and Arabic (RTL).
 */

export const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE || "en";

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  dir: "ltr" | "rtl";
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
  { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl" },
];

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((lang) => lang.code);

export function getLanguageByCode(code: string): SupportedLanguage | null {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code) || null;
}

export function isSupportedLanguage(code: string): boolean {
  return LANGUAGE_CODES.includes(code);
}

export function isRTLLanguage(code: string): boolean {
  return getLanguageByCode(code)?.dir === "rtl";
}

export const READING_LEVELS: Record<
  string,
  { gradeMin: number; gradeMax: number; label: string }
> = {
  elementary: { gradeMin: 1, gradeMax: 6, label: "Elementary School" },
  middle: { gradeMin: 7, gradeMax: 9, label: "Middle School" },
  high: { gradeMin: 10, gradeMax: 12, label: "High School" },
  college: { gradeMin: 13, gradeMax: 16, label: "College" },
  professional: { gradeMin: 17, gradeMax: Infinity, label: "Professional" },
};

export function getReadingLevelLabel(grade: number): string {
  for (const [, level] of Object.entries(READING_LEVELS)) {
    if (grade >= level.gradeMin && grade <= level.gradeMax) {
      return level.label;
    }
  }
  return "Professional";
}

export function getReadingLevelKey(grade: number): string {
  for (const [key, level] of Object.entries(READING_LEVELS)) {
    if (grade >= level.gradeMin && grade <= level.gradeMax) {
      return key;
    }
  }
  return "professional";
}

export function getReadingLevelGrade(score: number): number {
  return Math.max(0, score);
}
