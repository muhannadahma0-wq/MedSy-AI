import type { Locale } from "./i18n";

const intlLocale = (locale: Locale) => (locale === "ar" ? "ar" : "en");

export function fmtTime(locale: Locale, iso: string | Date): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtFullDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function fmtShortDate(locale: Locale, iso: string | Date): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function fmtPercent(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function greetingKey(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "todayGreetingMorning";
  if (h < 18) return "todayGreetingAfternoon";
  return "todayGreetingEvening";
}

/** bdi-safe display name for a medication, honoring the active locale. */
export function medName(
  locale: Locale,
  name: string,
  nameAr: string | null
): { primary: string; secondary: string | null } {
  if (locale === "ar") {
    return { primary: nameAr ?? name, secondary: nameAr ? name : null };
  }
  return { primary: name, secondary: nameAr };
}
