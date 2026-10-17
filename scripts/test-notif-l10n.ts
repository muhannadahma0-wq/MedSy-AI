/**
 * Task 2-c verification suite — notification localization (v5 review item 50)
 * + structured Arabic medical glossary (v5 review item 49).
 *
 * Unit-style checks over the shared NOTIF_TEXT template map, the language
 * picker, the EXTRA-escalation builder, the timezone-aware localized time
 * formatter, and the glossary shape/contract.
 *
 * Run: bun run scripts/test-notif-l10n.ts
 */
import {
  NOTIF_TEXT,
  renderNotif,
  pickNotifLanguage,
  timeStringForLanguage,
  formatRemindWindow,
  type NotifLanguage,
} from "../src/lib/server/notifications";
import { craftExtraMessage } from "../src/lib/server/reminder-engine";
import {
  MEDICAL_TERMS,
  getMedicalTermTranslation,
  getMedicalTermsDictionary,
} from "../src/lib/server/medical-terminology";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}${details ? ` — ${details}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${details ? ` — ${details}` : ""}`);
  }
}

const EN_MED = "Aspirin";
const AR_MED = "أسبرين";

console.log("\n=== 1. Template map completeness (every key has BOTH ar + en) ===");
const keys = Object.keys(NOTIF_TEXT);
check("NOTIF_TEXT is non-empty", keys.length > 0, `${keys.length} template keys`);
let bilingualOk = true;
let nonFunction: string[] = [];
for (const key of keys) {
  const tpl = NOTIF_TEXT[key];
  if (typeof tpl.en !== "function" || typeof tpl.ar !== "function") {
    bilingualOk = false;
    nonFunction.push(key);
  }
}
check("every template key has callable en + ar", bilingualOk, nonFunction.join(","));

console.log("\n=== 2. Rendering with an English medication name ===");
check(
  "onTime.msg.default en (Aspirin)",
  renderNotif("onTime.msg.default", "en", { med: EN_MED, time: "8:00 AM" }) ===
    `Time for ${EN_MED} at 8:00 AM. Your health journey matters! 🌱`
);
check(
  "basic.onTime.msg en (Aspirin)",
  renderNotif("basic.onTime.msg", "en", { med: EN_MED }) === `Take ${EN_MED} now`
);
check(
  "extra.title en (Aspirin)",
  renderNotif("extra.title", "en", { med: EN_MED }) === `Extra reminder — ${EN_MED}`
);

console.log("\n=== 3. Rendering with an Arabic medication name (name passes through AS-IS) ===");
check(
  "onTime.msg.default ar (أسبرين, raw name embedded)",
  renderNotif("onTime.msg.default", "ar", { med: AR_MED, time: "8:00 ص" }) ===
    `حان موعد ${AR_MED} الساعة 8:00 ص. رحلتكم الصحية تستحق العناية! 🌱`
);
check(
  "snooze.msg ar (أسبرين, raw name embedded)",
  renderNotif("snooze.msg", "ar", { med: AR_MED, slotTime: "08:00" }) ===
    `تذكير بجرعتكم من ${AR_MED} (08:00) — أُجّل بناءً على طلبكم.`
);
check(
  "snooze.msg en (أسبرین→ raw name embedded, never translated)",
  renderNotif("snooze.msg", "en", { med: AR_MED, slotTime: "08:00" }) ===
    `Reminder for your ${AR_MED} dose (08:00) — rescheduled as you asked.`
);
check(
  "before.msg.excellent1 ar renders percent + med as-is",
  renderNotif("before.msg.excellent1", "ar", { med: AR_MED, remindIn: "15 دقيقة", rate: 95 }) ===
    `نسبة التزامكم بالدواء 95٪ ممتازة! موعد تذكيركم بدواء ${AR_MED} بعد 15 دقيقة`
);

console.log("\n=== 4. No template throws on missing optional vars ===");
let threw: string[] = [];
let leaked: string[] = [];
for (const key of keys) {
  for (const lang of ["en", "ar"] as NotifLanguage[]) {
    try {
      const out = renderNotif(key, lang, { med: "TestMed" });
      if (out.includes("undefined") || out.includes("null")) leaked.push(`${key}[${lang}]`);
    } catch {
      threw.push(`${key}[${lang}]`);
    }
  }
}
check("no template throws with only {med} provided", threw.length === 0, threw.join(","));
check("no rendered string leaks 'undefined'/'null'", leaked.length === 0, leaked.join(","));
check(
  "missing template key degrades to medication name (never throws)",
  renderNotif("no.such.key", "ar", { med: "TestMed" }) === "TestMed"
);

console.log("\n=== 5. Language picker: ar / en / undefined / legacy values ===");
check(`pickNotifLanguage("ar") → "ar"`, pickNotifLanguage("ar") === "ar");
check(`pickNotifLanguage("en") → "en"`, pickNotifLanguage("en") === "en");
check(`pickNotifLanguage(undefined) → "en" (default)`, pickNotifLanguage(undefined) === "en");
check(`pickNotifLanguage(null) → "en"`, pickNotifLanguage(null) === "en");
check(`pickNotifLanguage("es") → "en" (legacy value falls back)`, pickNotifLanguage("es") === "en");
check(`pickNotifLanguage("") → "en"`, pickNotifLanguage("") === "en");

console.log("\n=== 6. EXTRA escalation builder (reminder-engine) ===");
const extraEn = craftExtraMessage({
  pillName: EN_MED,
  timeStr: "8:00 AM",
  language: "en",
  missedLast7d: 3,
  slotMissStreak: 2,
});
check(
  "extra en title",
  extraEn.title === `Extra reminder — ${EN_MED}`
);
check(
  "extra en message embeds both reasons with '; ' separator",
  extraEn.message.includes("3 doses not confirmed in the last 7 days") &&
    extraEn.message.includes("2 consecutive misses at this time slot") &&
    extraEn.message.includes("; ")
);
const extraAr = craftExtraMessage({
  pillName: AR_MED,
  timeStr: "8:00 ص",
  language: "ar",
  missedLast7d: 1,
  slotMissStreak: 1,
});
check(
  "extra ar title (raw med name)",
  extraAr.title === `تذكير إضافي — ${AR_MED}`
);
check(
  "extra ar message uses the Arabic semicolon '؛' and med as-is",
  extraAr.message.includes(AR_MED) && extraAr.message.includes("؛") && extraAr.message.includes("8:00 ص")
);
const extraNone = craftExtraMessage({ pillName: EN_MED, timeStr: "8:00 AM", language: "en" });
check(
  "extra with no risk reasons → no parenthetical appended",
  !extraNone.message.includes("(") && extraNone.message.includes("still not confirmed.")
);

console.log("\n=== 7. Timezone-aware localized time (tz semantics preserved) ===");
const instant = new Date("2026-09-30T00:30:00Z"); // 03:30 in Asia/Hebron (UTC+3)
const enTime = timeStringForLanguage(instant, "Asia/Hebron", "en");
const arTime = timeStringForLanguage(instant, "Asia/Hebron", "ar");
check("en keeps the exact legacy format ('3:30 AM')", enTime === "3:30 AM", enTime);
check("ar uses the Arabic meridiem with tz offset applied", /ص|م/.test(arTime), arTime);
check(
  "ar and en agree on the wall-clock digits (same zone math)",
  enTime.replace(/[^0-9:]/g, "") === arTime.replace(/[^0-9:]/g, ""),
  `${enTime} vs ${arTime}`
);
const utcTime = timeStringForLanguage(instant, "UTC", "en");
check("zone actually changes the result (no tz regression)", utcTime === "12:30 AM", utcTime);
check("invalid zone falls back without throwing", typeof timeStringForLanguage(instant, "Not/AZone", "ar") === "string");

console.log("\n=== 8. Remind-window formatting ===");
check(`formatRemindWindow("15m","en") stays "15m"`, formatRemindWindow("15m", "en") === "15m");
check(`formatRemindWindow("1h","en") stays "1h"`, formatRemindWindow("1h", "en") === "1h");
check(`formatRemindWindow("15m","ar") → "15 دقيقة"`, formatRemindWindow("15m", "ar") === "15 دقيقة");
check(`formatRemindWindow("1h","ar") → "ساعة واحدة"`, formatRemindWindow("1h", "ar") === "ساعة واحدة");
check(`formatRemindWindow("2h","ar") → "ساعتان"`, formatRemindWindow("2h", "ar") === "ساعتان");
check(`formatRemindWindow("30m","ar") → "30 دقيقة"`, formatRemindWindow("30m", "ar") === "30 دقيقة");
check("unknown format passes through unchanged", formatRemindWindow("xyz", "ar") === "xyz" && formatRemindWindow(undefined, "en") === "");

console.log("\n=== 9. Glossary shape + consumer contract (v5 item 49) ===");
const glossaryKeys = Object.keys(MEDICAL_TERMS);
check("glossary has ≥ 100 terms", glossaryKeys.length >= 100, `${glossaryKeys.length} terms`);
let allHaveAr = true;
let allHaveContext = true;
for (const [en, entry] of Object.entries(MEDICAL_TERMS)) {
  if (typeof entry.ar !== "string" || entry.ar.trim().length === 0) allHaveAr = false;
  if (typeof entry.context !== "string" || entry.context.trim().length === 0) allHaveContext = false;
}
check("every entry has a non-empty `ar` (existing consumers keep working)", allHaveAr);
check("every entry carries a `context` review note", allHaveContext);
const approved = Object.values(MEDICAL_TERMS).filter((e) => e.approved === true);
check(
  "approved:true ONLY on entries with reviewer 'pending-qualified-reviewer' (no faked sign-offs)",
  approved.every((e) => e.reviewer === "pending-qualified-reviewer"),
  `${approved.length} transliteration-approved entries`
);
check(
  "approved entries are a strict minority awaiting real review (honesty)",
  approved.length < glossaryKeys.length
);
check(
  "getMedicalTermTranslation('aspirin','ar') → أسبرين",
  getMedicalTermTranslation("aspirin", "ar") === "أسبرين"
);
check(
  "getMedicalTermTranslation is case-insensitive",
  getMedicalTermTranslation("Aspirin", "ar") === "أسبرين"
);
check(
  "getMedicalTermTranslation('aspirin','en') → passthrough",
  getMedicalTermTranslation("aspirin", "en") === "aspirin"
);
check(
  "unknown term passes through unchanged (never throws)",
  getMedicalTermTranslation("zzz-unknown-term", "ar") === "zzz-unknown-term"
);
const dict = getMedicalTermsDictionary("ar");
check(
  "getMedicalTermsDictionary('ar') maps every key (translation.ts pipeline contract)",
  Object.keys(dict).length === glossaryKeys.length
);
check("dictionary('ar')['hypertension'] → ارتفاع ضغط الدم", dict["hypertension"] === "ارتفاع ضغط الدم");
check(
  "dictionary('ar')['HbA1c'] → السكر التراكمي (new lab term)",
  dict["HbA1c"] === "السكر التراكمي (الهيموغلوبين السكري)"
);
check(
  "dictionary('en') falls back to the English term (legacy behaviour)",
  getMedicalTermsDictionary("en")["aspirin"] === "aspirin"
);

console.log(`\n──────────────────────────────────────────────`);
console.log(`Template keys localized: ${keys.length} (${keys.length * 2} language renderings)`);
console.log(`Glossary terms: ${glossaryKeys.length} (${approved.length} transliteration-approved, ${glossaryKeys.length - approved.length} awaiting qualified review)`);
console.log(`RESULT: ${passed} passed, ${failed} failed ${failed === 0 ? "— ALL CHECKS PASSED ✅" : "— FAILURES ❌"}`);
if (failed > 0) {
  console.log("Failed checks:", failures.join(", "));
  process.exit(1);
}
