/**
 * Port of server/src/api/notificationController.js — the personalized
 * notification scheduler.
 *
 * Same behaviour as the original: for each of today's medications, schedule
 * BEFORE / ON-TIME / AFTER reminders (skipping past times and duplicates),
 * generate the personalized message from adherence history + conversation
 * themes, persist each notification to the DailyNotification table, and fire
 * a test notification 10 seconds after the scheduler starts.
 *
 * The only adaptation: instead of `global.io` (Socket.IO lived inside the
 * original Express process), reminders are pushed to the socket.io
 * mini-service on port 3003 via its /emit HTTP endpoint.
 *
 * v5 review item 50 — LOCALIZATION: every user-facing string this module
 * (and the unified reminder engine) generates is defined ONCE in the
 * bilingual NOTIF_TEXT template map below and rendered per recipient
 * language (ar/en) resolved from User.preferredLanguage. The socket service
 * and NotificationToast display title/message AS-RECEIVED, so the server is
 * where the text must be finalized.
 */

import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { parseJson, type DosageTime, type AdherenceRecord, type NotificationMessage } from "./serialize";
import {
  atTimeInZone,
  dateKeyInZone,
  dayNameInZone,
  getUserTimeZone,
} from "./tz";

// SOCKET_EMIT_URL is the full authenticated bridge URL, e.g.
// http://<private-socket-host>:3004/emit on Render. The legacy scheduler
// uses the service root while the unified engine uses the full URL.
const SOCKET_EMIT_URL =
  process.env.SOCKET_EMIT_URL || "http://127.0.0.1:3004/emit";
const SOCKET_SERVICE = SOCKET_EMIT_URL.replace(/\/emit\/?$/, "");

// Global timer management to prevent duplicate notifications
const activeTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>();
const scheduledReminders = new Set<string>();

function clearUserTimers(userId: string) {
  const userTimers = activeTimers.get(userId);
  if (userTimers) {
    userTimers.forEach((timerId) => clearTimeout(timerId));
    userTimers.clear();
  }
  const keysToDelete: string[] = [];
  scheduledReminders.forEach((key) => {
    if (key.startsWith(`${userId}-`)) keysToDelete.push(key);
  });
  keysToDelete.forEach((key) => scheduledReminders.delete(key));
}

function addUserTimer(userId: string, timerId: ReturnType<typeof setTimeout>) {
  if (!activeTimers.has(userId)) {
    activeTimers.set(userId, new Set());
  }
  activeTimers.get(userId)!.add(timerId);
}

/** Phase 3: today's instant of `timeStr` in the user's timezone. */
function getTimeForTodayInZone(timeStr: string, timeZone: string): Date {
  return atTimeInZone(new Date(), timeStr, timeZone);
}

function getReminderKey(userId: string, medicationId: string, scheduledTime: Date, type: string) {
  return `${userId}-${medicationId}-${scheduledTime.toISOString()}-${type}`;
}

function parseDuration(str: string): number {
  if (!str) return 0;
  const unit = str.slice(-1);
  const value = parseInt(str);
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// BILINGUAL NOTIFICATION TEMPLATES (v5 review item 50).
//
// Rules:
//   - The MEDICATION NAME is inserted AS-IS, never translated. The FRONTEND
//     renders it with dir=auto / <bdi> isolation semantics; the server only
//     passes the raw name through (see NotifVars.med).
//   - Arabic is natural Modern Standard Arabic (MSA), respectful register —
//     no machine-translation artifacts.
//   - Times/durations keep the existing timezone-aware wall-clock semantics
//     (timeStringForLanguage / formatRemindWindow below); only the display
//     locale changes, never the zone math.
//   - Every template guards its optional variables, so a missing var can
//     never throw or leak "undefined" into a user-facing string.
// ─────────────────────────────────────────────────────────────────────────────

export type NotifLanguage = "ar" | "en";

/** Pure language picker — anything other than "ar" renders English. */
export function pickNotifLanguage(pref: string | null | undefined): NotifLanguage {
  return pref === "ar" ? "ar" : "en";
}

/**
 * The recipient's notification language, resolved from User.preferredLanguage
 * — the same field /api/languages/user reads+writes. Legacy values (es/hi)
 * and null fall back to English; DB errors fall back to English — never throws.
 */
export async function getUserNotificationLanguage(userId: string): Promise<NotifLanguage> {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } });
    return pickNotifLanguage(u?.preferredLanguage);
  } catch {
    return "en";
  }
}

export interface NotifVars {
  /** Medication name — inserted AS-IS (never translated); frontend renders dir=auto. */
  med: string;
  /** Timezone-aware display time (timeStringForLanguage). */
  time?: string;
  /** Localized remindBefore window (formatRemindWindow), e.g. "15m" / "15 دقيقة". */
  remindIn?: string;
  /** Adherence percentage 0..100 (null when no scheduled doses — P1-40). */
  rate?: number | null;
  /** Number of medications the user manages. */
  medCount?: number;
  /** Pre-formatted reason list for the EXTRA escalation message. */
  reasonText?: string;
  /** Raw slot time ("08:00") for snooze confirmations. */
  slotTime?: string;
  /** EXTRA escalation: unconfirmed doses in the last 7 days. */
  missedLast7d?: number;
  /** EXTRA escalation: consecutive misses at this time slot. */
  slotMissStreak?: number;
}

type BilingualTemplate = { en: (v: NotifVars) => string; ar: (v: NotifVars) => string };

export const NOTIF_TEXT: Record<string, BilingualTemplate> = {
  // ── BEFORE titles (upcoming reminder) ────────────────────────────────────
  "before.title.excellent": {
    en: () => `⭐ You're doing great! Upcoming reminder`,
    ar: () => `⭐ أداؤكم رائع! تذكير قادم`,
  },
  "before.title.good": {
    en: () => `🎯 Medicine reminder coming up`,
    ar: () => `🎯 تذكير بالدواء بعد قليل`,
  },
  "before.title.gentle": {
    en: () => `💙 Gentle reminder - your health matters`,
    ar: () => `💙 تذكير لطيف — صحتكم تهمنا`,
  },
  "before.title.default": {
    en: () => `⏰ Important: Medicine time approaching`,
    ar: () => `⏰ تنبيه: يقترب موعد دوائكم`,
  },

  // ── BEFORE messages ──────────────────────────────────────────────────────
  "before.msg.excellent1": {
    en: (v) => `Your ${v.rate ?? 0}% adherence rate is excellent! ${v.med} reminder in ${v.remindIn ?? ""}`,
    ar: (v) => `نسبة التزامكم بالدواء ${v.rate ?? 0}٪ ممتازة! موعد تذكيركم بدواء ${v.med} بعد ${v.remindIn ?? ""}`,
  },
  "before.msg.excellent2": {
    en: (v) => `You've been consistently taking ${v.med}. Reminder in ${v.remindIn ?? ""} 🌟`,
    ar: (v) => `لقد التزمتم بتناول ${v.med} بانتظام. تذكير بعد ${v.remindIn ?? ""} 🌟`,
  },
  "before.msg.excellent3": {
    en: (v) => `Great job staying on track! ${v.med} coming up in ${v.remindIn ?? ""}`,
    ar: (v) => `أحسنتم، أنتم على المسار الصحيح! موعد ${v.med} بعد ${v.remindIn ?? ""}`,
  },
  "before.msg.good": {
    en: (v) => `Building healthy habits! ${v.med} reminder in ${v.remindIn ?? ""}. You're at ${v.rate ?? 0}% adherence 💪`,
    ar: (v) => `استمروا في بناء عاداتكم الصحية! تذكير بدواء ${v.med} بعد ${v.remindIn ?? ""}. نسبة التزامكم ${v.rate ?? 0}٪ 💪`,
  },
  "before.msg.support": {
    en: (v) => `Taking care of yourself is important. ${v.med} reminder in ${v.remindIn ?? ""}. You've got this! 💙`,
    ar: (v) => `العناية بصحتكم مهمة. تذكير بدواء ${v.med} بعد ${v.remindIn ?? ""}. أنتم قادرون على ذلك! 💙`,
  },
  "before.msg.complex": {
    en: (v) => `Managing ${v.medCount ?? 0} medications is tough! ${v.med} reminder in ${v.remindIn ?? ""} 🎯`,
    ar: (v) => `إدارة ${v.medCount ?? 0} من الأدوية ليست بالأمر السهل! تذكير بدواء ${v.med} بعد ${v.remindIn ?? ""} 🎯`,
  },
  "before.msg.default": {
    en: (v) => `${v.med} reminder in ${v.remindIn ?? ""}. Every dose counts toward your health goals! 🌱`,
    ar: (v) => `تذكير بدواء ${v.med} بعد ${v.remindIn ?? ""}. كل جرعة تقرّبكم من أهدافكم الصحية! 🌱`,
  },

  // ── ON-TIME titles ──────────────────────────────────────────────────────
  "onTime.title.excellent": {
    en: () => `💊 Time for your medicine, champion!`,
    ar: () => `💊 حان موعد دوائكم — أحسنتم!`,
  },
  "onTime.title.pain": {
    en: () => `💊 Pain relief time - your medicine is ready`,
    ar: () => `💊 موعد التخفيف من الألم — دواؤكم جاهز`,
  },
  "onTime.title.positive": {
    en: () => `💊 Medicine time - keep that positive momentum!`,
    ar: () => `💊 موعد الدواء — حافظوا على هذا الحماس الإيجابي!`,
  },
  "onTime.title.default": {
    en: () => `💊 It's medicine time`,
    ar: () => `💊 حان موعد الدواء`,
  },

  // ── ON-TIME messages ────────────────────────────────────────────────────
  "onTime.msg.pain": {
    en: (v) => `Time for ${v.med} - this should help with your pain management 🩹`,
    ar: (v) => `حان موعد ${v.med} — من شأنه أن يساعدكم على التحكم في الألم 🩹`,
  },
  "onTime.msg.fatigue": {
    en: (v) => `${v.med} time! This may help with your energy levels ⚡`,
    ar: (v) => `موعد ${v.med}! قد يساعدكم على تحسين مستوى طاقتكم ⚡`,
  },
  "onTime.msg.positive": {
    en: (v) => `${v.med} at ${v.time ?? ""}. Love how you're taking charge of your health! ✨`,
    ar: (v) => `موعد ${v.med} الساعة ${v.time ?? ""}. رائع هذا الحرص على صحتكم! ✨`,
  },
  "onTime.msg.support": {
    en: (v) => `${v.med} time. Small steps, big progress. You're worth the care 💙`,
    ar: (v) => `موعد ${v.med}. خطوات صغيرة تصنع تقدماً كبيراً. صحتكم تستحق العناية 💙`,
  },
  "onTime.msg.excellent": {
    en: (v) => `${v.med} at ${v.time ?? ""}. Your consistency is inspiring! 🌟`,
    ar: (v) => `موعد ${v.med} الساعة ${v.time ?? ""}. التزامكم مثير للإعجاب! 🌟`,
  },
  "onTime.msg.good": {
    en: (v) => `${v.med} at ${v.time ?? ""}. Building those healthy habits! 💪`,
    ar: (v) => `موعد ${v.med} الساعة ${v.time ?? ""}. استمروا في بناء عاداتكم الصحية! 💪`,
  },
  "onTime.msg.default": {
    en: (v) => `Time for ${v.med} at ${v.time ?? ""}. Your health journey matters! 🌱`,
    ar: (v) => `حان موعد ${v.med} الساعة ${v.time ?? ""}. رحلتكم الصحية تستحق العناية! 🌱`,
  },

  // ── AFTER titles (missed-dose check-in) ─────────────────────────────────
  "after.title.multiple": {
    en: () => `❗ Multiple missed doses - let's get back on track`,
    ar: () => `❗ عدة جرعات فائتة — لنعد معاً إلى المسار الصحيح`,
  },
  "after.title.gentle": {
    en: () => `💙 Gentle check-in about your medicine`,
    ar: () => `💙 تفقدٌ لطيف بشأن دوائكم`,
  },
  "after.title.default": {
    en: () => `❗ Did you miss your medicine?`,
    ar: () => `❗ هل فاتكم موعد دوائكم؟`,
  },

  // ── AFTER messages ──────────────────────────────────────────────────────
  "after.msg.rate": {
    en: (v) => `${v.med} - you're usually good at ${v.rate ?? 0}% adherence. Just a gentle reminder to get back on track! 🎯`,
    ar: (v) => `${v.med} — التزامكم بالعادة جيد بنسبة ${v.rate ?? 0}٪. مجرد تذكير لطيف للعودة إلى المسار الصحيح! 🎯`,
  },
  "after.msg.default": {
    en: (v) => `${v.med} - did you forget? No worries, it happens! Consider setting a phone alarm for tomorrow 📱`,
    ar: (v) => `${v.med} — هل نسيتم الموعد؟ لا بأس، يحدث ذلك! جرّبوا ضبط منبّه على هاتفكم غداً 📱`,
  },

  // ── BASIC fallback notifications (generator error path) ─────────────────
  "basic.before.title": {
    en: () => `Medicine Reminder ⏰`,
    ar: () => `تذكير بالدواء ⏰`,
  },
  "basic.before.msg": {
    en: (v) => `Take ${v.med} soon`,
    ar: (v) => `تناولوا ${v.med} قريباً`,
  },
  "basic.onTime.title": {
    en: () => `Time to Take Medicine 💊`,
    ar: () => `موعد تناول الدواء 💊`,
  },
  "basic.onTime.msg": {
    en: (v) => `Take ${v.med} now`,
    ar: (v) => `تناولوا ${v.med} الآن`,
  },
  "basic.after.title": {
    en: () => `Missed Dose ❗`,
    ar: () => `جرعة فائتة ❗`,
  },
  "basic.after.msg": {
    en: (v) => `Did you forget ${v.med}?`,
    ar: (v) => `هل نسيتم تناول ${v.med}؟`,
  },

  // ── Boot test notification (legacy scheduler) ───────────────────────────
  "test.title": {
    en: () => `🔔 Test Notification`,
    ar: () => `🔔 إشعار تجريبي`,
  },
  "test.msg": {
    en: () => `This is a dummy test alert!`,
    ar: () => `هذا تنبيه تجريبي!`,
  },

  // ── EXTRA escalation (MEDSYNC-010, reminder-engine) ──────────────────────
  "extra.title": {
    en: (v) => `Extra reminder — ${v.med}`,
    ar: (v) => `تذكير إضافي — ${v.med}`,
  },
  "extra.msg": {
    en: (v) =>
      `Your ${v.med} dose at ${v.time ?? ""} is still not confirmed${v.reasonText ?? ""}. ` +
      `Confirming it on time keeps your treatment effective. This extra reminder was triggered by your personalized risk level.`,
    ar: (v) =>
      `جرعتكم من ${v.med} الساعة ${v.time ?? ""} لم يتم تأكيدها بعد${v.reasonText ?? ""}. ` +
      `تأكيد الجرعة في وقتها يحافظ على فعالية علاجكم. جاء هذا التذكير الإضافي بناءً على مستوى المخاطر المخصص لحالتكم.`,
  },
  "extra.reason.missed7d": {
    en: (v) => {
      const n = v.missedLast7d ?? 0;
      return `${n} dose${n > 1 ? "s" : ""} not confirmed in the last 7 days`;
    },
    ar: (v) => `جرعات غير مؤكدة خلال الأيام السبعة الماضية: ${v.missedLast7d ?? 0}`,
  },
  "extra.reason.slotStreak": {
    en: (v) => {
      const n = v.slotMissStreak ?? 0;
      return `${n} consecutive miss${n > 1 ? "es" : ""} at this time slot`;
    },
    ar: (v) => `تفويت متتالٍ لجرعات هذا الموعد اليومي: ${v.slotMissStreak ?? 0}`,
  },

  // ── SNOOZE confirmation (plan §11 — payload built by /api/dose-events/snooze) ──
  "snooze.title": {
    en: (v) => `Snoozed reminder — ${v.med}`,
    ar: (v) => `تذكير مؤجَّل — ${v.med}`,
  },
  "snooze.msg": {
    en: (v) => `Reminder for your ${v.med} dose (${v.slotTime ?? ""}) — rescheduled as you asked.`,
    ar: (v) => `تذكير بجرعتكم من ${v.med} (${v.slotTime ?? ""}) — أُجّل بناءً على طلبكم.`,
  },
};

/**
 * Render a template in `lang`. Never throws: a missing key or a rendering
 * error degrades to the English template, then to the raw medication name.
 */
export function renderNotif(key: string, lang: NotifLanguage, vars: NotifVars): string {
  const tpl = NOTIF_TEXT[key];
  if (!tpl) return vars.med;
  try {
    return tpl[lang](vars);
  } catch {
    try {
      return tpl.en(vars);
    } catch {
      return vars.med;
    }
  }
}

/**
 * Timezone-aware display time in the recipient's language. Identical zone
 * semantics to tz.timeStringInZone (same options); only the display locale
 * differs — Arabic keeps the 12-hour meridiem (ص/م) with Latin digits.
 */
export function timeStringForLanguage(instant: Date, timeZone: string, lang: NotifLanguage): string {
  const locale = lang === "ar" ? "ar-u-nu-latn" : "en-US";
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(instant);
  } catch {
    // Invalid zone (defensive — getUserTimeZone validates): degrade to UTC
    // rather than throwing; a notification must never fail on formatting.
    try {
      return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(instant);
    } catch {
      return instant.toISOString();
    }
  }
}

/** Arabic noun-agreement helpers for remind windows (1/2/3-10/11+). */
function formatHoursAr(n: number): string {
  if (n === 1) return "ساعة واحدة";
  if (n === 2) return "ساعتان";
  if (n >= 3 && n <= 10) return `${n} ساعات`;
  return `${n} ساعة`;
}

function formatMinutesAr(n: number): string {
  if (n === 1) return "دقيقة واحدة";
  if (n === 2) return "دقيقتان";
  if (n >= 3 && n <= 10) return `${n} دقائق`;
  return `${n} دقيقة`;
}

/**
 * Localized display of a remindBefore/remindAfter window ("15m", "1h").
 * English keeps the raw compact form verbatim (no regression); Arabic gets a
 * natural MSA duration. Unknown formats pass through unchanged — never throws.
 */
export function formatRemindWindow(raw: string | undefined, lang: NotifLanguage): string {
  const s = (raw ?? "").trim();
  if (lang === "en") return s;
  const m = /^(\d+)\s*m$/i.exec(s);
  if (m) return formatMinutesAr(parseInt(m[1], 10));
  const h = /^(\d+)\s*h$/i.exec(s);
  if (h) return formatHoursAr(parseInt(h[1], 10));
  return s;
}

// WebSocket notification helper — pushes to the socket.io mini-service
async function sendNotification(title: string, body: string, userId: string | null = null, type = "general") {
  const notificationData = {
    title,
    message: body,
    type,
    timestamp: new Date().toISOString(),
    id: Date.now() + Math.random(),
  };

  console.log(`[WEBSOCKET NOTIFY] ${title}: ${body}`);

  try {
    const body = JSON.stringify({ userId, notification: notificationData });
    const secret =
      process.env.JWT_SECRET ||
      (process.env.NODE_ENV === "production" ? "" : "medsync-ai-sandbox-secret");
    if (!secret) {
      console.warn("JWT_SECRET is missing; notification bridge call was refused.");
      return;
    }
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    await fetch(`${SOCKET_SERVICE}/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-emit-signature": signature,
      },
      body,
    });
  } catch (err) {
    console.warn("Socket.IO mini-service unreachable — notification not pushed:", (err as Error).message);
  }
}

interface MedLike {
  id: string;
  pillName: string;
  dosageTimes: unknown;
  adherenceHistory: unknown;
}

interface ConversationLike {
  input: string;
  output: string;
}

/**
 * 🎯 PERSONALIZED NOTIFICATION GENERATOR (ported verbatim; v5 item 50 adds the
 * language layer). Exported for reuse by the unified reminder engine
 * (MEDSYNC-004). `timeZone` (Phase 3) formats the dose time in the USER's
 * zone — the scheduler's zone would show the wrong wall-clock to everyone
 * else. `language` (optional) lets a caller that already resolved the
 * recipient's language pass it through; when omitted it is resolved from
 * User.preferredLanguage here.
 */
export async function generatePersonalizedNotification(
  userId: string,
  medication: MedLike,
  notificationType: "before" | "onTime" | "after",
  _doseTime: Date,
  timeZone?: string,
  language?: NotifLanguage
): Promise<{ title: string; message: string }> {
  try {
    const lang = language ?? (await getUserNotificationLanguage(userId));
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    const history = parseJson<AdherenceRecord[]>(medication.adherenceHistory, []);
    const adherenceStats = history
      .filter((record) => new Date(record.date) >= lastWeek)
      .reduce(
        (stats, record) => {
          stats.total++;
          if (record.status === "taken") stats.taken++;
          if (record.status === "missed") stats.missed++;
          if (record.status === "delayed") stats.delayed++;
          return stats;
        },
        { total: 0, taken: 0, missed: 0, delayed: 0 }
      );

    // P1-40 — zero scheduled doses is NOT 100%: null → generic (non-claims)
    // wording in the personalization helpers below.
    const adherenceRate: number | null =
      adherenceStats.total > 0 ? Math.round((adherenceStats.taken / adherenceStats.total) * 100) : null;

    // v5 item 50 — latent-bug fix: the original port queried
    // `where: { user, model }` — fields that no longer exist on the
    // Conversation 2.0 table (userId/agent since the migration), so this
    // query ALWAYS threw and every "personalized" notification silently
    // fell back to the basic strings. Corrected to the live schema; the
    // theme-analysis logic itself is unchanged.
    const recentConversationRows = await db.conversation.findMany({
      where: { userId, agent: { in: ["personal-health", "medical"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const recentConversations: ConversationLike[] = recentConversationRows.map((c) => {
      const msgs = parseJson<{ role?: string; content?: string }[]>(c.messages, []);
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      return { input: lastUser?.content ?? "", output: lastAssistant?.content ?? "" };
    });

    const conversationInsights = analyzeConversationThemes(recentConversations);

    const allMedications = await db.medication.findMany({ where: { userId } });
    const healthProfile = analyzeHealthProfile(allMedications as unknown as MedLike[]);

    return createPersonalizedMessage(
      notificationType,
      medication,
      adherenceStats,
      adherenceRate,
      conversationInsights,
      healthProfile,
      _doseTime,
      timeZone ?? "UTC",
      lang
    );
  } catch (error) {
    console.error("Error generating personalized notification:", error);
    return getBasicNotification(notificationType, medication, language ?? "en");
  }
}

interface Themes {
  symptoms: string[];
  concerns: string[];
  improvements: string[];
  sideEffects: string[];
  mood: string;
}

function analyzeConversationThemes(conversations: ConversationLike[]): Themes {
  const themes: Themes = {
    symptoms: [],
    concerns: [],
    improvements: [],
    sideEffects: [],
    mood: "neutral",
  };

  conversations.forEach((conv) => {
    const text = (conv.input + " " + conv.output).toLowerCase();
    if (text.includes("pain") || text.includes("ache") || text.includes("hurt")) themes.symptoms.push("pain");
    if (text.includes("tired") || text.includes("fatigue") || text.includes("energy")) themes.symptoms.push("fatigue");
    if (text.includes("nausea") || text.includes("sick") || text.includes("stomach")) themes.symptoms.push("digestive");
    if (text.includes("better") || text.includes("good") || text.includes("improved")) themes.mood = "positive";
    if (text.includes("worse") || text.includes("bad") || text.includes("difficult")) themes.mood = "negative";
    if (text.includes("side effect") || text.includes("reaction")) themes.sideEffects.push("mentioned");
  });

  return themes;
}

function analyzeHealthProfile(medications: MedLike[]) {
  const profile = {
    medicationCount: medications.length,
    commonTimes: [] as string[],
    medicationTypes: [] as string[],
    complexity: "simple",
  };

  const timeFrequency: Record<string, number> = {};
  medications.forEach((med) => {
    parseJson<DosageTime[]>(med.dosageTimes, []).forEach((dose) => {
      timeFrequency[dose.time] = (timeFrequency[dose.time] || 0) + 1;
    });
  });

  profile.commonTimes = Object.keys(timeFrequency)
    .sort((a, b) => timeFrequency[b] - timeFrequency[a])
    .slice(0, 3);

  if (medications.length > 3) profile.complexity = "complex";
  else if (medications.length > 1) profile.complexity = "moderate";

  return profile;
}

function createPersonalizedMessage(
  type: "before" | "onTime" | "after",
  medication: MedLike,
  adherenceStats: { total: number; taken: number; missed: number; delayed: number },
  adherenceRate: number | null,
  insights: Themes,
  profile: { medicationCount: number; complexity: string },
  doseTime: Date,
  timeZone: string,
  lang: NotifLanguage
): { title: string; message: string } {
  const pillName = medication.pillName; // inserted AS-IS — never translated (v5 item 50)
  const timeStr = timeStringForLanguage(doseTime, timeZone, lang);

  let title: string, message: string;

  switch (type) {
    case "before":
      title = getPersonalizedBeforeTitle(adherenceRate, insights, lang);
      message = getPersonalizedBeforeMessage(pillName, medication, adherenceRate, insights, profile, lang);
      break;
    case "onTime":
      title = getPersonalizedOnTimeTitle(adherenceRate, insights, lang);
      message = getPersonalizedOnTimeMessage(pillName, adherenceRate, insights, timeStr, lang);
      break;
    case "after":
      title = getPersonalizedAfterTitle(adherenceStats, insights, lang);
      message = getPersonalizedAfterMessage(pillName, adherenceStats, lang);
      break;
    default:
      return getBasicNotification(type, medication, lang);
  }

  return { title, message };
}

function getPersonalizedBeforeTitle(
  adherenceRate: number | null,
  insights: Themes,
  lang: NotifLanguage
): string {
  if (adherenceRate !== null && adherenceRate >= 90) return renderNotif("before.title.excellent", lang, { med: "" });
  if (adherenceRate !== null && adherenceRate >= 70) return renderNotif("before.title.good", lang, { med: "" });
  if (insights.mood === "negative") return renderNotif("before.title.gentle", lang, { med: "" });
  return renderNotif("before.title.default", lang, { med: "" });
}

function getPersonalizedBeforeMessage(
  pillName: string,
  medication: MedLike,
  adherenceRate: number | null,
  insights: Themes,
  profile: { medicationCount: number; complexity: string },
  lang: NotifLanguage
): string {
  const remindIn = formatRemindWindow(parseJson<DosageTime[]>(medication.dosageTimes, [])[0]?.remindBefore || "15m", lang);

  if (adherenceRate !== null && adherenceRate >= 90) {
    const encouragement = ["before.msg.excellent1", "before.msg.excellent2", "before.msg.excellent3"];
    const key = encouragement[Math.floor(Math.random() * encouragement.length)];
    return renderNotif(key, lang, { med: pillName, remindIn, rate: adherenceRate });
  }

  if (adherenceRate !== null && adherenceRate >= 70) {
    return renderNotif("before.msg.good", lang, { med: pillName, remindIn, rate: adherenceRate });
  }

  if (insights.mood === "negative" || insights.symptoms.length > 0) {
    return renderNotif("before.msg.support", lang, { med: pillName, remindIn });
  }

  if (profile.complexity === "complex") {
    return renderNotif("before.msg.complex", lang, { med: pillName, remindIn, medCount: profile.medicationCount });
  }

  return renderNotif("before.msg.default", lang, { med: pillName, remindIn });
}

function getPersonalizedOnTimeTitle(
  adherenceRate: number | null,
  insights: Themes,
  lang: NotifLanguage
): string {
  if (adherenceRate !== null && adherenceRate >= 90) return renderNotif("onTime.title.excellent", lang, { med: "" });
  if (insights.symptoms.includes("pain")) return renderNotif("onTime.title.pain", lang, { med: "" });
  if (insights.mood === "positive") return renderNotif("onTime.title.positive", lang, { med: "" });
  return renderNotif("onTime.title.default", lang, { med: "" });
}

function getPersonalizedOnTimeMessage(
  pillName: string,
  adherenceRate: number | null,
  insights: Themes,
  timeStr: string,
  lang: NotifLanguage
): string {
  if (insights.symptoms.includes("pain")) {
    return renderNotif("onTime.msg.pain", lang, { med: pillName });
  }
  if (insights.symptoms.includes("fatigue")) {
    return renderNotif("onTime.msg.fatigue", lang, { med: pillName });
  }
  if (insights.mood === "positive") {
    return renderNotif("onTime.msg.positive", lang, { med: pillName, time: timeStr });
  }
  if (insights.mood === "negative") {
    return renderNotif("onTime.msg.support", lang, { med: pillName });
  }
  if (adherenceRate !== null && adherenceRate >= 90) {
    return renderNotif("onTime.msg.excellent", lang, { med: pillName, time: timeStr });
  }
  if (adherenceRate !== null && adherenceRate >= 70) {
    return renderNotif("onTime.msg.good", lang, { med: pillName, time: timeStr });
  }
  return renderNotif("onTime.msg.default", lang, { med: pillName, time: timeStr });
}

function getPersonalizedAfterTitle(
  adherenceStats: { missed: number },
  insights: Themes,
  lang: NotifLanguage
): string {
  if (adherenceStats.missed > 2) return renderNotif("after.title.multiple", lang, { med: "" });
  if (insights.mood === "negative") return renderNotif("after.title.gentle", lang, { med: "" });
  return renderNotif("after.title.default", lang, { med: "" });
}

function getPersonalizedAfterMessage(
  pillName: string,
  adherenceStats: { total: number; taken: number },
  lang: NotifLanguage
): string {
  if (adherenceStats.total > 0) {
    const rate = Math.round((adherenceStats.taken / adherenceStats.total) * 100);
    return renderNotif("after.msg.rate", lang, { med: pillName, rate });
  }
  return renderNotif("after.msg.default", lang, { med: pillName });
}

function getBasicNotification(type: string, medication: MedLike, lang: NotifLanguage): { title: string; message: string } {
  const basic: Record<string, { title: string; message: string }> = {
    before: {
      title: renderNotif("basic.before.title", lang, { med: medication.pillName }),
      message: renderNotif("basic.before.msg", lang, { med: medication.pillName }),
    },
    onTime: {
      title: renderNotif("basic.onTime.title", lang, { med: medication.pillName }),
      message: renderNotif("basic.onTime.msg", lang, { med: medication.pillName }),
    },
    after: {
      title: renderNotif("basic.after.title", lang, { med: medication.pillName }),
      message: renderNotif("basic.after.msg", lang, { med: medication.pillName }),
    },
  };
  return basic[type] || basic.onTime;
}

// Persist a notification message to today's DailyNotification doc (upsert + push)
// Exported for reuse by the unified reminder engine (MEDSYNC-004).
export async function persistNotification(
  userId: string,
  todayDate: string,
  todayDay: string,
  message: NotificationMessage
) {
  const existing = await db.dailyNotification.findUnique({
    where: { userId_date: { userId, date: todayDate } },
  });
  if (existing) {
    const list = parseJson<NotificationMessage[]>(existing.notifications, []);
    list.push(message);
    await db.dailyNotification.update({
      where: { id: existing.id },
      data: { notifications: JSON.stringify(list) },
    });
  } else {
    await db.dailyNotification.create({
      data: {
        userId,
        date: todayDate,
        dayName: todayDay,
        notifications: JSON.stringify([message]),
      },
    });
  }
}

// Main scheduler (port of startNotificationScheduler)
export default async function startNotificationScheduler(userPayload: {
  user?: { id: string; name?: string; email?: string };
}): Promise<{ scheduled: number }> {
  let userId: string | null = null;
  if (userPayload?.user?.id) {
    userId = String(userPayload.user.id);
  }

  if (!userId) {
    console.error("Invalid user object passed to scheduler");
    return { scheduled: 0 };
  }

  clearUserTimers(userId);

  try {
    const timeZone = await getUserTimeZone(userId);
    // v5 item 50 — resolve the recipient's language ONCE per scheduler run
    // (User.preferredLanguage → ar/en, English default) and localize every
    // generated notification with it.
    const language = await getUserNotificationLanguage(userId);
    const today = new Date();
    const todayDay = dayNameInZone(today, timeZone);
    const todayDate = dateKeyInZone(today, timeZone);

    const allMeds = await db.medication.findMany({ where: { userId } });
    const todaysMeds = allMeds.filter((m) => {
      const days = parseJson<string[]>(m.dosageDays, []);
      return days.includes(todayDay);
    });

    todaysMeds.sort((a, b) => {
      const ta = parseJson<DosageTime[]>(a.dosageTimes, [])[0]?.time || "00:00";
      const tb = parseJson<DosageTime[]>(b.dosageTimes, [])[0]?.time || "00:00";
      return ta.localeCompare(tb);
    });

    for (const med of todaysMeds) {
      const medLike = med as unknown as MedLike;
      const doses = parseJson<DosageTime[]>(med.dosageTimes, []);

      for (const dose of doses) {
        const medTime = getTimeForTodayInZone(dose.time, timeZone);

        // BEFORE reminder
        const beforeMs = medTime.getTime() - parseDuration(dose.remindBefore);
        if (beforeMs > Date.now()) {
          const beforeTime = new Date(beforeMs);
          const reminderKey = getReminderKey(userId, med.id, beforeTime, "before");
          if (!scheduledReminders.has(reminderKey)) {
            scheduledReminders.add(reminderKey);
            const notif = await generatePersonalizedNotification(userId, medLike, "before", medTime, timeZone, language);
            const timerId = setTimeout(async () => {
              await sendNotification(notif.title, notif.message, userId, "before");
              await markReminderSent(med.id, dose.time);
            }, beforeMs - Date.now());
            addUserTimer(userId, timerId);
            await persistNotification(userId, todayDate, todayDay, {
              title: notif.title,
              message: notif.message,
              type: "before",
              medicineId: med.id,
              medicineName: med.pillName,
              time: beforeTime.toISOString(),
            });
          }
        }

        // ON-TIME reminder
        if (medTime.getTime() > Date.now()) {
          const reminderKey = getReminderKey(userId, med.id, medTime, "onTime");
          if (!scheduledReminders.has(reminderKey)) {
            scheduledReminders.add(reminderKey);
            const notif = await generatePersonalizedNotification(userId, medLike, "onTime", medTime, timeZone, language);
            const timerId = setTimeout(async () => {
              await sendNotification(notif.title, notif.message, userId, "onTime");
              await markReminderSent(med.id, dose.time);
            }, medTime.getTime() - Date.now());
            addUserTimer(userId, timerId);
            await persistNotification(userId, todayDate, todayDay, {
              title: notif.title,
              message: notif.message,
              type: "onTime",
              medicineId: med.id,
              medicineName: med.pillName,
              time: medTime.toISOString(),
            });
          }
        }

        // AFTER reminder
        const afterMs = medTime.getTime() + parseDuration(dose.remindAfter);
        if (afterMs > Date.now()) {
          const afterTime = new Date(afterMs);
          const reminderKey = getReminderKey(userId, med.id, afterTime, "after");
          if (!scheduledReminders.has(reminderKey)) {
            scheduledReminders.add(reminderKey);
            const notif = await generatePersonalizedNotification(userId, medLike, "after", medTime, timeZone, language);
            const timerId = setTimeout(async () => {
              await sendNotification(notif.title, notif.message, userId, "after");
              await markReminderSent(med.id, dose.time);
            }, afterMs - Date.now());
            addUserTimer(userId, timerId);
            await persistNotification(userId, todayDate, todayDay, {
              title: notif.title,
              message: notif.message,
              type: "after",
              medicineId: med.id,
              medicineName: med.pillName,
              time: afterTime.toISOString(),
            });
          }
        }
      }
    }

    // 🔹 Dummy test notification after 10 seconds (as in the original; localized v5 item 50)
    const testTitle = renderNotif("test.title", language, { med: "" });
    const testMsg = renderNotif("test.msg", language, { med: "" });
    const testTimerId = setTimeout(async () => {
      await sendNotification(testTitle, testMsg, userId, "test");
      await persistNotification(userId, todayDate, todayDay, {
        title: testTitle,
        message: testMsg,
        type: "test",
        time: new Date().toISOString(),
      });
    }, 10 * 1000);
    addUserTimer(userId, testTimerId);

    const userTimers = activeTimers.get(userId);
    return { scheduled: userTimers ? userTimers.size : 0 };
  } catch (err) {
    console.error("Error scheduling notifications:", err);
    return { scheduled: 0 };
  }
}

async function markReminderSent(medicationId: string, doseTime: string) {
  const med = await db.medication.findUnique({ where: { id: medicationId } });
  if (!med) return;
  const doses = parseJson<DosageTime[]>(med.dosageTimes, []);
  const updated = doses.map((d) =>
    d.time === doseTime ? { ...d, lastReminderSentAt: new Date().toISOString() } : d
  );
  await db.medication.update({
    where: { id: medicationId },
    data: { dosageTimes: JSON.stringify(updated) },
  });
}

// Retrieve today's notification messages (port of getTodaysNotifications)
export async function getTodaysNotifications(
  userOrId: string | { id?: string; user?: { id?: string } } | null | undefined
): Promise<NotificationMessage[]> {
  try {
    let userId: string | null = null;
    if (!userOrId) return [];
    if (typeof userOrId === "string") userId = userOrId;
    else if ((userOrId as { id?: string }).id) userId = String((userOrId as { id: string }).id);
    else if ((userOrId as { user?: { id?: string } }).user?.id)
      userId = String((userOrId as { user: { id: string } }).user.id);
    if (!userId) return [];

    const timeZone = await getUserTimeZone(userId);
    const todayDate = dateKeyInZone(new Date(), timeZone);
    const doc = await db.dailyNotification.findUnique({
      where: { userId_date: { userId, date: todayDate } },
    });
    if (!doc) return [];
    return parseJson<NotificationMessage[]>(doc.notifications, []);
  } catch (err) {
    console.error("Error in getTodaysNotifications:", err);
    return [];
  }
}
