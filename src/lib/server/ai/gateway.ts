/**
 * AI Gateway — the single orchestrator of the multi-agent architecture
 * (spec §5, §23-26, §28-29, §35-37, §41, §49, §53).
 *
 * Pipeline (every conversational request passes through here):
 *
 *   USER → [Safety Router] → emergency? YES → Emergency Agent (+severity)
 *                              NO ↓
 *                       [Intent Classifier] → specialist
 *                              ↓
 *                       [Context Builder]  → ONLY the tools/data the agent
 *                                            is permitted to see (§20-21, §36-37)
 *                              ↓
 *                       [Agent Execution]  → existing per-agent module
 *                                            (own prompt/memory — §30 fallback
 *                                            keeps the SAME specialization)
 *                              ↓
 *                       [Output Validator] → handoff detection (§24-26),
 *                                            escalation guarantee (§41),
 *                                            severity + confidence (§11, §32)
 *                              ↓
 *                       [AiLog]            → data-minimized audit row (§35)
 *
 * ML is NOT an agent (§43): risk predictions are read from storage and
 * EXPLAINED; never recomputed by an LLM.
 */

import { randomUUID, createHash } from "crypto";
import { db } from "@/lib/db";
import {
  AGENTS,
  HANDOFF_MARKER_PATTERNS,
  HANDOFF_TARGETS,
  detectHandoffTarget,
  type AgentKey,
} from "./agent-registry";
import {
  getAdherence,
  getDoseHistory,
  getHealthProfile,
  getMedications,
  getStoredRiskExplanation,
  checkInteractions,
  type ToolCallContext,
} from "./tools";
import { medicalModelHandler } from "../models/medical-model";
import { medicineModelHandler } from "../models/medicine-model";
import { personalHealthModelHandler } from "../models/personal-health-model";
import { emergencyModelHandler } from "../models/emergency-model";
import { providerLabel, resolveChain, providerModelLabel, type ProviderName } from "./providers";
import {
  getOrCreateConversation,
  loadHistory,
  getSummaryForPrompt,
  appendExchange,
  type ConversationRow,
} from "../conversations";

export type IntentLabel =
  | "MEDICAL_KNOWLEDGE"
  | "MEDICATION"
  | "PERSONAL_HEALTH"
  | "EMERGENCY"
  | "UNKNOWN";

export type SeverityTier = "low" | "moderate" | "urgent" | "emergency";

// ---------------------------------------------------------------------------
// MASTER AUDIT P0-25/P0-27 — deterministic red-flag engine, VERSIONED and
// CONFIGURABLE. The rule set is the single source of truth for emergency
// classification; the LLM can never downgrade it (§41). Extra keywords can
// be added through env without a code change:
//   EMERGENCY_KEYWORDS_EXTRA="keyword one,keyword two"
//   URGENT_KEYWORDS_EXTRA="..."
// ---------------------------------------------------------------------------

export const SAFETY_RULES_VERSION = process.env.SAFETY_RULES_VERSION || "2026-09-29.1";

function envKeywords(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const EMERGENCY_KEYWORDS = [
  "chest pain", "can't breathe", "cant breathe", "cannot breathe", "difficulty breathing",
  "trouble breathing", "shortness of breath", "severe bleeding", "bleeding heavily",
  "unconscious", "passed out", "fainted", "seizure", "convulsion", "stroke",
  "heart attack", "suicide", "kill myself", "end my life", "overdose",
  "took too many pills", "poisoning", "swallowed", "anaphylaxis", "throat closing",
  "severe allergic reaction", "emergency",
  "ألم في الصدر", "الم في الصدر", "ألم شديد في الصدر", "ألم حاد في الصدر",
  "ضيق التنفس", "ضيق تنفس", "ضيق في التنفس", "صعوبة في التنفس",
  "صعوبة التنفس", "لا أستطيع التنفس", "نزيف", "فقدان الوعي", "فقدت الوعي",
  "إغماء", "تشنج", "سكتة دماغية", "جلطة", "نوبة قلبية", "انتحار", "أنتحر",
  "جرعة زائدة", "تسمم", "بلعت", "حساسية شديدة", "طارئ", "طوارئ", "الطوارئ",
  ...envKeywords("EMERGENCY_KEYWORDS_EXTRA"),
];

/** Second severity tier — urgent but not immediately life-threatening (§11). */
const URGENT_KEYWORDS = [
  "high fever", "vomiting blood", "severe pain", "blood in", "worsening fast",
  "getting worse quickly", "can't keep fluids", "dehydrated",
  "حمى عالية", "قيء دم", "ألم شديد", "دم في", "يسوء بسرعة", "جفاف شديد",
  ...envKeywords("URGENT_KEYWORDS_EXTRA"),
];

/** Personal-history intent phrases — checked BEFORE medicine (spec §5 example). */
const PERSONAL_HISTORY_KEYWORDS = [
  "how many doses", "doses did i miss", "doses have i missed", "my adherence",
  "adherence statistics", "adherence this", "my streak", "my dose history",
  "my medication history", "which medication has", "my health data", "my profile",
  "my risk", "highest risk", "predicted risk",
  "كم جرعة", "جرعات فاتتني", "فوّت", "فوتت", "إحصاءات الالتزام", "التزامي",
  "سجل جرعاتي", "تاريخ أدويتي", "أعلى خطر", "خطر الجرعة", "ملفي الصحي", "بياناتي",
];

const PERSONAL_HEALTH_KEYWORDS = [
  "weight", "bmi", "diet", "exercise", "workout", "fitness", "sleep quality",
  "sleep schedule", "lifestyle", "habit", "smoking", "quit smoking", "caffeine",
  "hydration", "water intake", "stress management", "daily steps",
  "وزني", "الوزن", "حمية", "النظام الغذائي", "الرجيم", "تمرين", "التمارين",
  "الرياضة", "ممارسة الرياضة", "اللياقة", "جودة النوم", "نمط الحياة",
  "التدخين", "الإقلاع عن التدخين", "القهوة", "شرب الماء", "التوتر", "الخطوات اليومية",
];

const MEDICINE_KEYWORDS = [
  "dose", "dosage", "how many pills", "how often should i take", "when should i take",
  "missed dose", "double dose", "take with food", "empty stomach", "interaction",
  "interactions", "side effect", "side effects", "pill", "tablets", "capsule",
  "medication schedule", "generic name", "storage", "refill", "prescription",
  "expired", "antibiotic", "painkiller", "insulin", "warfarin",
  "جرعة", "الجرعة", "الجرعات", "حبوب", "قرص", "كبسولة", "أقراص", "تفاعل",
  "التفاعلات", "أثر جانبي", "آثار جانبية", "مع الطعام", "المعدة الفارغة",
  "نسيت الجرعة", "موعد الدواء", "بدون وصفة", "وصفة طبية", "منتهي الصلاحية",
  "مضاد حيوي", "مسكن", "إنسولين", "وارفارين",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function matches(haystack: string, keywords: string[]): string[] {
  return keywords.filter((k) => haystack.includes(k));
}

// ---------------------------------------------------------------------------
// Safety router (§23) + intent classifier (§22)
// ---------------------------------------------------------------------------

export interface SafetyResult {
  isEmergency: boolean;
  severity: SeverityTier | null;
  matched: string[];
}

export function safetyCheck(message: string): SafetyResult {
  const text = normalize(message);
  const emergency = matches(text, EMERGENCY_KEYWORDS);
  if (emergency.length > 0) return { isEmergency: true, severity: "emergency", matched: emergency };
  const urgent = matches(text, URGENT_KEYWORDS);
  if (urgent.length > 0) return { isEmergency: true, severity: "urgent", matched: urgent };
  return { isEmergency: false, severity: null, matched: [] };
}

export interface IntentDecision {
  agent: AgentKey;
  intent: IntentLabel;
  matched: string[];
  rule: string;
}

export function classifyIntent(message: string): IntentDecision {
  const text = normalize(message);
  // Priority 1: personal-HISTORY phrases beat generic medicine words (§5).
  const history = matches(text, PERSONAL_HISTORY_KEYWORDS);
  if (history.length > 0) {
    return { agent: "personal-health", intent: "PERSONAL_HEALTH", matched: history, rule: "personal-history keyword" };
  }
  const personal = matches(text, PERSONAL_HEALTH_KEYWORDS);
  if (personal.length > 0) {
    return { agent: "personal-health", intent: "PERSONAL_HEALTH", matched: personal, rule: "lifestyle keyword" };
  }
  const medicine = matches(text, MEDICINE_KEYWORDS);
  if (medicine.length > 0) {
    return { agent: "medicine", intent: "MEDICATION", matched: medicine, rule: "medication keyword" };
  }
  if (text.length >= 4) {
    return { agent: "medical", intent: "MEDICAL_KNOWLEDGE", matched: [], rule: "default scope (general medical knowledge)" };
  }
  return { agent: "medical", intent: "UNKNOWN", matched: [], rule: "empty/near-empty input" };
}

// ---------------------------------------------------------------------------
// Context builder (§36-37) — ONLY permitted tools, ONLY relevant data
// ---------------------------------------------------------------------------

async function buildContext(
  agentKey: AgentKey,
  userId: string,
  message: string
): Promise<{ contextText: string; toolCalls: string[] }> {
  const ctx: ToolCallContext = { agentKey, userId };
  const text = normalize(message);
  const parts: string[] = [];
  const toolCalls: string[] = [];

  if (agentKey === "personal-health") {
    const wantsHistory = /dose|miss|adherence|streak|history|جرع|فوت|التزام|سجل/.test(text);
    const wantsRisk = /risk|خطر/.test(text);
    const wantsProfile = /profile|weight|height|age|ملف|وزن|طول/.test(text);
    if (wantsHistory || wantsRisk) {
      try {
        const summary = await getAdherence(ctx, 30);
        toolCalls.push("getAdherenceSummary");
        parts.push(
          `Adherence last ${summary.windowDays} days (verified tool data): ` +
            (summary.adherenceRate === null
              ? "N/A — no resolved doses in the window yet (insufficient data)."
              : `${Math.round(summary.adherenceRate * 100)}% confirmed, ` +
                `${summary.onTimeRate === null ? "N/A" : `${Math.round(summary.onTimeRate * 100)}%`} on time, streak ${summary.streakDays} days, ` +
                `missed ${summary.missed}, delayed ${summary.delayed} of ${summary.resolved} resolved doses.`)
        );
        const history = await getDoseHistory(ctx, 30);
        toolCalls.push("getDoseHistory");
        parts.push(
          `Recent dose history: missed this week ${history.missedThisWeek}, delayed this week ${history.delayedThisWeek}.`
        );
      } catch { /* tool denial or failure is non-fatal */ }
    }
    if (wantsRisk) {
      try {
        const risks = await getStoredRiskExplanation(ctx, 3);
        toolCalls.push("getStoredRiskExplanation");
        if (risks.length > 0) {
          parts.push(
            "Stored ML risk predictions for upcoming doses (READ-ONLY — explain, never recompute): " +
              risks
                .map(
                  (r) =>
                    `{risk: ${Math.round(r.riskScore * 100)}% (${r.riskLevel}), scheduled: ${r.scheduledAt}, explanation: ${r.explanation || "n/a"}}`
                )
                .join("; ")
          );
        }
      } catch { /* non-fatal */ }
    }
    if (wantsProfile) {
      try {
        const profile = await getHealthProfile(ctx);
        toolCalls.push("getHealthProfile");
        if (profile) parts.push(`Health profile: ${JSON.stringify(profile)}`);
      } catch { /* non-fatal */ }
    }
  }

  if (agentKey === "medicine" || agentKey === "emergency") {
    // OWNER REVIEW 2026-10-01 (explicit user requirement: "the Medication
    // Specialist agent must know what medications have been added"):
    // the caller's medication list is injected UNCONDITIONALLY for the
    // medicine agent. Previously it was gated on keyword matches
    // ("my meds"/"أدويتي"/"interaction"…), so a generic question like
    // "is ibuprofen ok?" reached the model with NO medication context.
    // Emergency already received them unconditionally. Correct side effect:
    // medicine answers now always carry personal tool data → cacheEligible()
    // excludes them from the shared knowledge cache (a cached answer could
    // otherwise reflect ANOTHER user's regimen).
    try {
      const meds = await getMedications(ctx);
      toolCalls.push("getMedications");
      if (meds.length > 0) {
        parts.push(
          `User's current medications: ${meds.map((m) => `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`).join(", ")}.`
        );
        // Known interactions among the caller's own meds are screened
        // proactively whenever ≥2 meds exist — the specialist should flag
        // risky pairs without being explicitly asked (was: only on
        // "interaction" keyword matches).
        if (meds.length >= 2) {
          const interaction = await checkInteractions(ctx, meds.map((m) => m.name));
          toolCalls.push("checkInteractions");
          if (interaction.interactions.length > 0) {
            parts.push(
              `Known interactions among these medications: ${interaction.interactions
                .map((i) => `${i.drug1}+${i.drug2} (${i.severity})`)
                .join("; ")}.`
            );
          }
        }
      } else {
        // Explicit "none" so the agent KNOWS the list is empty (vs. missing).
        parts.push("User's current medications: none added yet.");
      }
    } catch { /* non-fatal */ }
  }

  if (parts.length === 0) return { contextText: "", toolCalls };
  // §33 grounding: verified data the model must treat as ground truth.
  return {
    contextText:
      "[VERIFIED DATA from your authorized tools — treat as ground truth, do not invent numbers]\n" +
      parts.join("\n") +
      "\n[END VERIFIED DATA]\n\n",
    toolCalls,
  };
}

// ---------------------------------------------------------------------------
// MASTER AUDIT P0-26 — locale-aware emergency number, derived from the
// caller's stored timezone. Never a hard-coded "911" for the whole planet;
// when the region is unknown the honest fallback is "your local emergency
// number".
// ---------------------------------------------------------------------------

const EMERGENCY_NUMBER_BY_TZ: Array<[RegExp, string]> = [
  // Levant / Palestine — Red Crescent ambulance line (911 also routes in some areas).
  [/^Asia\/(Hebron|Jerusalem|Gaza|Amman|Beirut|Damascus)$/, "101"],
  [/^Asia\/Cairo$/, "123"],
  [/^Asia\/Riyadh$/, "997"],
  [/^Asia\/Qatar$/, "997"],
  [/^Asia\/Kuwait$/, "997"],
  [/^Asia\/Bahrain$/, "999"],
  [/^Asia\/Dubai$|^Asia\/Muscat$/, "998"],
  [/^(America|Canada)\//, "911"],
  [/^Europe\/(London|Belfast)$/, "999"],
  [/^Europe\//, "112"],
  [/^Africa\//, "112"],
  [/^Australia\//, "000"],
  [/^Pacific\/Auckland$/, "111"],
  [/^Asia\/Tokyo$/, "119"],
  [/^Asia\/Kolkata$|^Asia\/Calcutta$/, "112"],
  [/^Asia\/Karachi$/, "112"],
  [/^Asia\/Istanbul$/, "112"],
];

export function localeEmergencyNumber(timeZone?: string | null): string {
  if (!timeZone) return "your local emergency number";
  for (const [re, num] of EMERGENCY_NUMBER_BY_TZ) {
    if (re.test(timeZone)) return num;
  }
  return "your local emergency number";
}

// ---------------------------------------------------------------------------
// Output validation (§28-29, §41) + MASTER AUDIT P0-43 — the independent
// Safety/Verification Gate between the specialist and the user.
// ---------------------------------------------------------------------------

function ensureEscalationLine(output: string, language: string, emergencyNumber: string): string {
  const line =
    language === "ar"
      ? `\n\n⚠️ إذا كانت هذه حالة طبية طارئة، اتصل بالرقم ${emergencyNumber} الآن أو اطلب المساعدة الطبية العاجلة فورًا. لا يمكن لهذا المساعد تشخيص الحالات أو أن يحل محل خدمات الطوارئ.`
      : `\n\n⚠️ If this may be a medical emergency, call ${emergencyNumber} now or seek immediate medical help right away. This assistant cannot diagnose or replace emergency services.`;
  // Skip ONLY when a concrete escalation with a number/phrase is already
  // present — a bare mention of "emergency" does not suppress the number.
  // MR-5 central fix (2026-10-01): the skip test previously accepted a bare
  // digit-less «رقم الطوارئ»/"emergency number" mention as "already
  // escalated" and suppressed the locale number line. Now the skip requires
  // a CONCRETE number near an escalation phrase (call/dial + 2-3 digits, or
  // digits near emergency wording), or the locale-derived number itself.
  const already =
    /(?:call|dial|اتصل|بالاتصال)[^\n]{0,40}?\b\d{2,3}\b|\b\d{2,3}\b[^\n]{0,40}?(?:emergency|طوارئ)|\b911\b|\b112\b|\b999\b|\b101\b/i.test(
      output
    ) ||
    (emergencyNumber !== "your local emergency number" &&
      new RegExp(`\\b${emergencyNumber}\\b`).test(output));
  return already ? output : output.trimEnd() + line;
}

// ---------------------------------------------------------------------------
// MASTER AUDIT P0-43 — deterministic output verification gate.
// The specialist's answer is checked BEFORE the user sees it; violations are
// corrected with an explicit safe note and recorded in the audit log.
// ---------------------------------------------------------------------------

const CERTAINTY_VIOLATIONS: RegExp[] = [
  /you (definitely|certainly|100%) (have|are suffering|suffer)/i,
  /(guaranteed|assured) (cure|recovery|healing)/i,
  /this is definitely (a|an) (disease|condition|infection)/i,
  /هذا بالتأكيد (مرض|حالة|عدوى)/,
  /الشفاء مضمون/i,
  /بالتأكيد أنت (مصاب|تعاني)/i,
];

const INJECTION_MARKERS: RegExp[] = [
  /ignore (all|any|the|previous|prior|above) instructions/i,
  /disregard (the )?(system|previous|above|prior)/i,
  /system prompt/i,
  /تجاهل (جميع )?التعليمات/i,
];

const INTERNAL_ID_PATTERN = /\bcm[a-z0-9]{20,}\b/;

export interface VerificationOutcome {
  result: "pass" | "warnings" | "corrected" | "skipped";
  warnings: string[];
  /** Safe correction appended to the output when a hard violation is found. */
  correction: string | null;
}

function verifyOutput(
  output: string,
  language: "en" | "ar"
): VerificationOutcome {
  const warnings: string[] = [];
  let needsCorrection = false;

  for (const re of CERTAINTY_VIOLATIONS) {
    if (re.test(output)) {
      warnings.push(
        language === "ar"
          ? "تم رصد صياغة تشخيصية مؤكدة — لا يمكن للمساعد تأكيد تشخيص."
          : "Overconfident diagnostic phrasing detected — an assistant cannot confirm a diagnosis."
      );
      needsCorrection = true;
      break;
    }
  }
  for (const re of INJECTION_MARKERS) {
    if (re.test(output)) {
      warnings.push(
        language === "ar"
          ? "تم رصد نص يشبه تعليمات مضمنة — يُعامل كنص عادي فقط."
          : "Embedded instruction-like text detected — treated as plain text only."
      );
      break;
    }
  }
  if (INTERNAL_ID_PATTERN.test(output)) {
    warnings.push(
      language === "ar"
        ? "ظهر معرّف داخلي في الرد — يُرجى إبلاغ الدعم إذا رأيت أكواد قواعد بيانات."
        : "An internal identifier appeared in the answer — please report database-style codes to support."
    );
  }

  const correction = needsCorrection
    ? language === "ar"
      ? "\n\n✅ تصحيح مهم: لا يمكن لأي مساعد ذكاء اصطناعي تأكيد تشخيص طبي بيقين. يُرجى مناقشة الأعراض والنتائج مع مختص مؤهل."
      : "\n\n✅ Important correction: no AI assistant can confirm a medical diagnosis with certainty. Please discuss symptoms and results with a qualified clinician."
    : null;

  return {
    result: warnings.length === 0 ? "pass" : needsCorrection ? "corrected" : "warnings",
    warnings,
    correction,
  };
}

/**
 * Honest degraded-mode reply (§30/§32): when EVERY provider in the chain is
 * exhausted (e.g. gateway rate-limit after sustained load), the user must
 * still get a clear, non-technical, bilingual message — never a raw
 * "API request failed with status 429" dump. The technical detail stays in
 * the `error` field for diagnostics; the emergency agent keeps its
 * rule-based escalation line (which never depends on any LLM).
 */
function degradedOutput(agent: string, language: string): string {
  if (agent === "emergency") {
    return language === "ar"
      ? "⚠️ تعذّر توليد تحليل الطوارئ الآن (جميع مزودي الذكاء الاصطناعي مشغولون مؤقتًا). إذا كانت هناك أعراض خطيرة — ألم صدر، ضيق تنفس، فقدان وعي — فاتصل برقم الطوارئ فورًا. هذا المساعد لا يعوّض خدمات الطوارئ."
      : "⚠️ The AI analysis is temporarily unavailable (all providers are rate-limited). If you have severe symptoms — chest pain, breathing difficulty, loss of consciousness — call your local emergency number (e.g., 911) right now. This assistant cannot replace emergency services.";
  }
  return language === "ar"
    ? "خدمة الذكاء الاصطناعي مشغولة مؤقتًا (تم تجاوز حد الطلبات لجميع المزودين). يرجى إعادة المحاولة بعد دقيقة — هذا ليس رأيًا طبيًا ولا يؤثر على بياناتك أو أدويتك."
    : "The AI service is temporarily busy (all providers hit their rate limit). Please try again in a minute — this does not affect your data or medications, and it is not a medical opinion.";
}

function isHandoffMarker(answer: string): boolean {
  return HANDOFF_MARKER_PATTERNS.some((re) => re.test(answer));
}

// ---------------------------------------------------------------------------
// v5 review item 35 — AI RESPONSE CACHE.
//
// static medical knowledge → cacheable; personal health → no shared cache.
//
// A question like "What is hypertension?" asks for STATIC, user-independent
// knowledge: two users asking the same normalized question get equally valid
// answers, so a short-lived shared cache saves a provider call. An answer
// that touched the caller's PRIVATE data (their medications, dose history,
// health profile, adherence, stored ML risk explanations) is personal by
// construction and must NEVER be served to another user — so ANY tool call
// recorded by the context builder disqualifies the request. Emergency,
// personal-health, vision and report answers are never cached either.
//
// In-memory (globalThis-anchored like the breaker store so it survives HMR),
// TTL 24h, LRU cap 200 entries. Cache hits still write an AiLog row
// (provider "cache") and still append to the conversation thread, but do
// NOT consume request budget.
// ---------------------------------------------------------------------------

const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AI_CACHE_MAX_ENTRIES = 200;

interface AiCacheEntry {
  output: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  createdAt: number;
  expiresAt: number;
}

interface AiCacheStore {
  entries: Map<string, AiCacheEntry>; // Map preserves insertion order → LRU
}

const AI_CACHE_KEY = "__medsyncAiResponseCache";
const cacheGlobal = globalThis as typeof globalThis & { [AI_CACHE_KEY]?: AiCacheStore };
const aiCache: AiCacheStore = (cacheGlobal[AI_CACHE_KEY] ??= { entries: new Map() });

/** lowercase + trim + collapse whitespace + strip punctuation (works for
 *  Latin and Arabic alike: only letters/numbers/space survive). */
function cacheNormalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKeyFor(agent: string, language: string, message: string): string {
  return createHash("sha256")
    .update(`${agent}|${language}|${cacheNormalize(message)}`)
    .digest("hex");
}

function cacheGet(key: string): AiCacheEntry | null {
  const entry = aiCache.entries.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    aiCache.entries.delete(key);
    return null;
  }
  // LRU refresh: re-insert so recently used keys survive eviction.
  aiCache.entries.delete(key);
  aiCache.entries.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: AiCacheEntry): void {
  if (aiCache.entries.has(key)) aiCache.entries.delete(key);
  while (aiCache.entries.size >= AI_CACHE_MAX_ENTRIES) {
    const oldest = aiCache.entries.keys().next().value;
    if (oldest === undefined) break;
    aiCache.entries.delete(oldest);
  }
  aiCache.entries.set(key, entry);
}

const CACHEABLE_AGENTS: AgentKey[] = ["medical", "medicine"];
const CACHEABLE_INTENTS: IntentLabel[] = ["MEDICAL_KNOWLEDGE", "MEDICATION"];

/** Cache eligibility — see the block comment above (item 35). */
function cacheEligible(
  agent: AgentKey,
  intent: IntentLabel,
  emergency: boolean,
  toolCalls: string[]
): boolean {
  return (
    CACHEABLE_AGENTS.includes(agent) &&
    CACHEABLE_INTENTS.includes(intent) &&
    !emergency &&
    toolCalls.length === 0 // ANY personal-data tool → personal answer → no shared cache
  );
}

/** Cache stats for the monitoring/test surface. */
export function aiCacheStats(): { size: number; cap: number; ttlHours: number } {
  return { size: aiCache.entries.size, cap: AI_CACHE_MAX_ENTRIES, ttlHours: AI_CACHE_TTL_MS / 3600000 };
}

// ---------------------------------------------------------------------------
// v5 review item 34 — DAILY REQUEST BUDGET (cost guard).
//
// Per (userId, agent) counter, UTC date-keyed, globalThis-anchored (survives
// HMR like the breaker/cache stores). Cached answers are FREE: budget is
// consumed ONLY on actual provider calls.
//
// The EMERGENCY agent is EXEMPT from the per-user cap ON PURPOSE (safety
// first): refusing to triage a possible emergency because the user chatted
// too much today would be a safety failure, not a cost control. The shared
// platform quota is still protected by the high global cap.
// ---------------------------------------------------------------------------

const DAILY_AGENT_REQUESTS = Math.max(
  1,
  parseInt(process.env.AI_DAILY_AGENT_REQUESTS || "40", 10) || 40
);
const GLOBAL_AGENT_DAILY = Math.max(
  1,
  parseInt(process.env.AI_GLOBAL_AGENT_DAILY || "5000", 10) || 5000
);

interface BudgetStore {
  day: string; // UTC date key — counters reset on rollover
  perUserAgent: Map<string, number>; // `${userId}|${agent}` → provider calls today
  perAgent: Map<string, number>; // agent → provider calls today (all users)
}

const BUDGET_KEY = "__medsyncAiBudget";
const budgetGlobal = globalThis as typeof globalThis & { [BUDGET_KEY]?: BudgetStore };
const budgetStore: BudgetStore = (budgetGlobal[BUDGET_KEY] ??= {
  day: new Date().toISOString().slice(0, 10),
  perUserAgent: new Map(),
  perAgent: new Map(),
});

function budgetResetIfNewDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (budgetStore.day !== today) {
    budgetStore.day = today;
    budgetStore.perUserAgent.clear();
    budgetStore.perAgent.clear();
  }
}

export interface BudgetDecision {
  allowed: boolean;
  reason: "ok" | "per_user" | "global";
  perUserUsed: number;
  perUserCap: number; // 0 → exempt (emergency)
  globalUsed: number;
  globalCap: number;
}

/** Pure check — does NOT consume. Emergency skips the per-user cap (see above). */
export function checkAiBudget(userId: string, agent: AgentKey): BudgetDecision {
  budgetResetIfNewDay();
  const perUserCap = agent === "emergency" ? 0 : DAILY_AGENT_REQUESTS;
  const perUserUsed = budgetStore.perUserAgent.get(`${userId}|${agent}`) || 0;
  const globalUsed = budgetStore.perAgent.get(agent) || 0;
  if (perUserCap > 0 && perUserUsed >= perUserCap) {
    return { allowed: false, reason: "per_user", perUserUsed, perUserCap, globalUsed, globalCap: GLOBAL_AGENT_DAILY };
  }
  if (globalUsed >= GLOBAL_AGENT_DAILY) {
    return { allowed: false, reason: "global", perUserUsed, perUserCap, globalUsed, globalCap: GLOBAL_AGENT_DAILY };
  }
  return { allowed: true, reason: "ok", perUserUsed, perUserCap, globalUsed, globalCap: GLOBAL_AGENT_DAILY };
}

/** Consume one provider call for (userId, agent) — call right BEFORE the
 *  provider attempt; cached hits never reach this. */
export function consumeAiBudget(userId: string, agent: AgentKey): void {
  budgetResetIfNewDay();
  const userKey = `${userId}|${agent}`;
  budgetStore.perUserAgent.set(userKey, (budgetStore.perUserAgent.get(userKey) || 0) + 1);
  budgetStore.perAgent.set(agent, (budgetStore.perAgent.get(agent) || 0) + 1);
}

// ---------------------------------------------------------------------------
// Agent execution — the existing per-agent modules ARE the specialists
// (own prompt + memory + provider chain; §30 preserved by construction).
// ---------------------------------------------------------------------------

type AgentModuleResult = {
  status: number;
  body: {
    success: boolean;
    output?: string;
    text?: string;
    error?: string;
    provider?: string;
    model?: string;
    latencyMs?: number;
    fallbackUsed?: boolean;
  };
};

type AnyHandler = (params: {
  userId?: string;
  user?: { id?: string };
  message?: string;
  input?: string;
  language?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  summary?: string;
}) => Promise<AgentModuleResult>;

const HANDLERS: Record<AgentKey, AnyHandler> = {
  medical: medicalModelHandler as unknown as AnyHandler,
  medicine: medicineModelHandler as unknown as AnyHandler,
  "personal-health": personalHealthModelHandler as unknown as AnyHandler,
  emergency: emergencyModelHandler as unknown as AnyHandler,
};

export interface GatewayOptions {
  message: string;
  userId: string;
  language: "en" | "ar";
  /** UI-selected specialist — a HINT, never overrides safety (§50). */
  preferredAgent?: AgentKey;
  /** Conversation 2.0 — thread to continue (foreign/archived ids are ignored). */
  conversationId?: string;
}

export interface GatewayResult {
  status: number;
  body: {
    success: boolean;
    output?: string;
    error?: string;
    routedTo: AgentKey;
    handoffFrom?: AgentKey | null;
    intent: IntentLabel;
    severity?: SeverityTier | null;
    confidence: "high" | "medium" | "needs_verification";
    warnings: string[];
    needs_handoff: boolean;
    handoff_agent: AgentKey | null;
    provider: string;
    model: string;
    fallbackUsed: boolean;
    toolCalls: string[];
    requestId: string;
    latencyMs: number;
    // MASTER AUDIT P1-42 — structured response contract.
    actions: string[];
    uncertainty: string;
    needsProfessionalReview: boolean;
    verification: { result: "pass" | "warnings" | "corrected" | "skipped"; warnings: string[] };
    // MASTER AUDIT P2-56 — reproducibility metadata.
    agentVersion: string;
    policyVersion: string;
    modelVersion: string;
    router: {
      mechanism: string;
      rule: string;
      matched: string[];
      emergencyEscalationAppended: boolean;
      safetyResult: string;
    };
    // Conversation 2.0 (v5) — thread + audit + cache + budget metadata.
    /** Thread id the exchange was appended to (null when threading failed). */
    conversationId?: string | null;
    /** AiLog audit row id (null when the audit write failed). */
    logId?: string | null;
    /** True when the answer came from the AI response cache (item 35). */
    cached?: boolean;
    /** How many history turns were injected into the agent prompt. */
    historyUsed?: number;
  };
}

/** v5 item 34 — daily-budget rejection (HTTP 429), matching the API error
 *  contract shape { success:false, error:{code,message} }. */
export interface GatewayBudgetResult {
  status: 429;
  body: {
    success: false;
    error: {
      code: "AI_BUDGET_EXCEEDED";
      message: string;
      limit: { perUserPerAgent: number; globalPerAgent: number; resetsAtUtcMidnight: true };
    };
    routedTo: AgentKey;
    requestId: string;
  };
}

/** P2-56 — every agent response carries its versions for reproducibility. */
const AGENT_VERSION = "2.0.0";

/** Write the data-minimized audit row (§35). Never blocks the answer. */
async function writeAiLog(entry: {
  requestId: string;
  userId: string;
  agent: string;
  provider: string;
  model: string;
  intent: IntentLabel;
  severity?: SeverityTier | null;
  fallbackUsed: boolean;
  handoff: boolean;
  handoffFrom?: string | null;
  safetyResult: string;
  toolCalls: string[];
  latencyMs: number;
  success: boolean;
  inputPreview: string;
  answerLength: number;
}): Promise<string | null> {
  try {
    const row = await db.aiLog.create({
      data: {
        requestId: entry.requestId,
        user: entry.userId,
        agent: entry.agent,
        provider: entry.provider,
        model: entry.model,
        intent: entry.intent,
        severity: entry.severity ?? null,
        fallbackUsed: entry.fallbackUsed,
        handoff: entry.handoff,
        handoffFrom: entry.handoffFrom ?? null,
        safetyResult: entry.safetyResult,
        toolCalls: JSON.stringify(entry.toolCalls),
        latencyMs: entry.latencyMs,
        success: entry.success,
        inputPreview: entry.inputPreview.slice(0, 80),
        answerLength: entry.answerLength,
      },
    });
    return row.id;
  } catch (err) {
    console.warn("[ai-gateway] AiLog write failed (non-fatal):", (err as Error).message);
    return null;
  }
}

/**
 * The gateway entry point. ONE hop of auto-handoff is completed (§24: the
 * handoff goes THROUGH the router, never agent→agent directly); a second
 * hop is refused to prevent loops.
 *
 * Conversation 2.0 (v5): every request threads a DB-backed conversation —
 * history + rolling summary are injected into the specialist prompt and the
 * exchange is appended after the answer. Cache hits (item 35) and the daily
 * budget guard (item 34) are checked between routing and execution.
 */
export async function runGateway(
  options: GatewayOptions
): Promise<GatewayResult | GatewayBudgetResult> {
  const started = Date.now();
  const requestId = randomUUID();
  const message = options.message.slice(0, 2000);
  const { userId, language } = options;

  // 1) SAFETY FIRST (§23, §41) — emergency keywords always win, even over
  // a user-selected specialist (§50: choosing an agent cannot bypass safety).
  const safety = safetyCheck(message);

  let agent: AgentKey;
  let intent: IntentLabel;
  let rule: string;
  let matched: string[];
  let safetyResult: string;
  let handoffFrom: AgentKey | null = null;

  if (safety.isEmergency) {
    // §41 + §50: safety ALWAYS wins — even over a user-selected specialist.
    agent = "emergency";
    intent = "EMERGENCY";
    rule = "urgent-symptom keyword (safety priority)";
    matched = safety.matched;
    safetyResult = `emergency_priority:${safety.severity}`;
    if (options.preferredAgent && options.preferredAgent !== "emergency") {
      handoffFrom = options.preferredAgent; // record the redirect honestly
    }
  } else {
    const decision = classifyIntent(message);
    if (
      options.preferredAgent &&
      options.preferredAgent !== decision.agent &&
      decision.rule === "personal-history keyword"
    ) {
      // §6/§26 + §50: the router VERIFIES the question — data-ownership
      // phrases ("my adherence", "how many doses did I miss"…) belong to
      // the Personal Health agent regardless of the picked specialist;
      // record the router-corrected redirect.
      agent = decision.agent;
      intent = decision.intent;
      rule = "personal-history data-ownership (router-corrected from user preference)";
      matched = decision.matched;
      handoffFrom = options.preferredAgent;
    } else if (options.preferredAgent && options.preferredAgent !== decision.agent) {
      // §50 — the user's choice is honored but safety-verified; the agent's
      // own scope boundary + handoff will correct genuinely wrong picks.
      agent = options.preferredAgent;
      intent = decision.intent;
      rule = `user preference (safety-verified; classifier suggested ${decision.agent})`;
      matched = decision.matched;
    } else {
      agent = decision.agent;
      intent = decision.intent;
      rule = decision.rule;
      matched = decision.matched;
    }
    safetyResult = "ok";
  }

  // 2) Context builder — permitted tools only (§20-21, §36-37).
  const { contextText, toolCalls } = await buildContext(agent, userId, message);

  // 3) AI response cache lookup (v5 item 35) — BEFORE any provider call so
  //    a hit costs nothing. Eligibility: knowledge-type intent on
  //    medical/medicine, no emergency, and NO personal-data tool calls.
  const cacheable = cacheEligible(agent, intent, safety.isEmergency, toolCalls);
  const cacheKey = cacheable ? cacheKeyFor(agent, language, message) : null;
  const cacheHit = cacheKey ? cacheGet(cacheKey) : null;

  // 4) Conversation 2.0 thread — get-or-create AFTER routing decides the
  //    agent (the emergency path threads an "emergency" conversation too, so
  //    the thread stays complete). A conversationId that belongs to another
  //    user or is archived is IGNORED and a new thread is created (never
  //    leaked). Threading is non-fatal: a DB failure must not block answers.
  let conversation: ConversationRow | null = null;
  try {
    conversation = await getOrCreateConversation(userId, agent, options.conversationId, language);
  } catch (err) {
    console.warn("[ai-gateway] conversation threading failed (non-fatal):", (err as Error).message);
  }
  const history = conversation ? loadHistory(conversation, 16) : [];
  const summaryNote = conversation ? getSummaryForPrompt(conversation) : "";

  // 5) Execute the specialist (§30: fallback inside the module keeps the
  //    SAME agent, different provider) — with the thread's history + summary
  //    injected. Cache hits skip the provider call (and the budget).
  let result: AgentModuleResult;
  let provider: string;
  let model: string;
  let output = "";
  let cached = false;
  let needsHandoff = false;

  if (cacheHit) {
    cached = true;
    output = cacheHit.output;
    provider = "cache";
    model = cacheHit.model;
    result = {
      status: 200,
      body: {
        success: true,
        output: cacheHit.output,
        text: cacheHit.output,
        provider: "cache",
        model: cacheHit.model,
        fallbackUsed: cacheHit.fallbackUsed,
      },
    };
  } else {
    // 5a) Daily request budget (v5 item 34) — counted ONLY on actual
    //     provider calls; cached answers never reach this point.
    const budget = checkAiBudget(userId, agent);
    if (!budget.allowed) {
      console.warn(
        `[ai-gateway] AI_BUDGET_EXCEEDED: user=${userId} agent=${agent} reason=${budget.reason} ` +
          `(per-user ${budget.perUserUsed}/${budget.perUserCap || "exempt"}, global ${budget.globalUsed}/${budget.globalCap})`
      );
      const messageText =
        budget.reason === "global"
          ? `The daily AI capacity for the "${agent}" agent is temporarily exhausted platform-wide. Please try again after midnight UTC.`
          : `Daily AI request limit reached for the "${agent}" agent (${budget.perUserCap} requests/day per user). The limit resets at midnight UTC — cached knowledge questions remain available.`;
      return {
        status: 429,
        body: {
          success: false,
          error: {
            code: "AI_BUDGET_EXCEEDED",
            message: messageText,
            limit: {
              perUserPerAgent: budget.perUserCap || DAILY_AGENT_REQUESTS,
              globalPerAgent: budget.globalCap,
              resetsAtUtcMidnight: true,
            },
          },
          routedTo: agent,
          requestId,
        },
      };
    }
    consumeAiBudget(userId, agent);

    const runAgent = (key: AgentKey, input: string) =>
      HANDLERS[key]({
        userId,
        user: { id: userId },
        message: input,
        input, // legacy alias (kept for module backward compatibility)
        language,
        history,
        summary: summaryNote,
      });

    result = await runAgent(agent, contextText + message);
    provider = result.body.provider || "zai-glm";
    model = result.body.model || providerModelLabel("zai" as ProviderName);
    output = result.body.output || "";

    // 5b) Output validation — handoff detection (§6, §24-26). One hop max.
    //     Target selection is QUESTION-FIRST: the original message's own
    //     classification (deterministic keywords) decides where it belongs;
    //     the answer's redirection text is only the fallback signal. This
    //     prevents a redirect mentioning "urgent situations" from sending a
    //     plain medication question to the emergency agent.
    if (!safety.isEmergency && isHandoffMarker(output)) {
      const questionIntent = classifyIntent(message);
      let target = detectHandoffTarget(output);
      if (
        questionIntent.agent !== agent &&
        questionIntent.matched.length > 0 &&
        HANDOFF_TARGETS[agent].includes(questionIntent.agent)
      ) {
        target = questionIntent.agent;
      }
      if (target && HANDOFF_TARGETS[agent].includes(target) && target !== agent) {
        needsHandoff = true;
        handoffFrom = agent;
        const second = await runAgent(target, contextText + message);
        if (second.body.output) {
          result = second;
          output = second.body.output;
          provider = second.body.provider || provider;
          model = second.body.model || model;
          agent = target; // the FINAL agent is who answered (§49)
        }
      }
    }
  }

  // Emergency guarantees (§11-13, §41): escalation line + severity.
  // MASTER AUDIT P0-26 — the escalation number is LOCALE-AWARE (derived from
  // the caller's stored timezone), never a global hard-coded 911.
  let severity: SeverityTier | null = safety.severity;
  let emergencyNumber = "your local emergency number";
  if (agent === "emergency") {
    try {
      const caller = await db.user.findUnique({
        where: { id: userId },
        select: { timeZone: true },
      });
      emergencyNumber = localeEmergencyNumber(caller?.timeZone);
    } catch {
      /* timezone lookup is best-effort; the honest fallback is used */
    }
    output = ensureEscalationLine(output, language, emergencyNumber);
    if (!severity) severity = "moderate";
  }

  // MASTER AUDIT P0-43 — independent Safety/Verification Gate: the answer is
  // deterministically checked before the user sees it; hard violations get an
  // explicit safe correction appended and are recorded in the audit log.
  const verification = verifyOutput(output, language);
  if (verification.correction) {
    output = output.trimEnd() + verification.correction;
  }

  const fallbackUsed = cached ? Boolean(cacheHit?.fallbackUsed) : provider === "zai-glm";
  const latencyMs = Date.now() - started;

  // §30/§32 — every provider exhausted → honest bilingual degraded reply
  // (raw technical error stays in `error` for diagnostics).
  if (!result.body.success) {
    output = degradedOutput(agent, language);
  }

  // 5c) Cache store (v5 item 35) — only successful, eligible answers, and
  //     only the FINAL post-verification output.
  if (cacheable && !cached && cacheKey && result.body.success && output.trim()) {
    cacheSet(cacheKey, {
      output,
      provider,
      model,
      fallbackUsed,
      createdAt: Date.now(),
      expiresAt: Date.now() + AI_CACHE_TTL_MS,
    });
  }

  // 6) Audit row (§35) — includes the verification-gate outcome (P0-43);
  //    cache hits are logged with provider "cache".
  const logId = await writeAiLog({
    requestId,
    userId,
    agent,
    provider,
    model,
    intent,
    severity,
    fallbackUsed,
    handoff: needsHandoff,
    handoffFrom,
    safetyResult: safetyResult + `|verify:${verification.result}`,
    toolCalls,
    latencyMs,
    success: Boolean(result.body.success && output),
    inputPreview: message,
    answerLength: output.length,
  });

  // 7) Conversation 2.0 — append the exchange to the thread (real answers
  //    only; a degraded "service busy" placeholder never pollutes history).
  if (conversation && result.body.success && output.trim()) {
    try {
      await appendExchange(conversation.id, userId, message, output, {
        agent,
        language,
        provider,
        modelVersion: model,
        promptVersion: SAFETY_RULES_VERSION,
      });
    } catch (err) {
      console.warn("[ai-gateway] conversation append failed (non-fatal):", (err as Error).message);
    }
  }

  // P1-42 — deterministic structured-response fields.
  const actions: string[] =
    agent === "emergency"
      ? [
          language === "ar"
            ? `اتصل بالرقم ${emergencyNumber} الآن إن كانت الأعراض شديدة.`
            : `Call ${emergencyNumber} now if the symptoms are severe.`,
        ]
      : toolCalls.includes("checkInteractions")
        ? [
            language === "ar"
              ? "راجع تحذير التفاعل الدوائي مع الصيدلي أو الطبيب."
              : "Review the interaction warning with your pharmacist or clinician.",
          ]
        : [];
  const uncertainty =
    language === "ar"
      ? "هذه معلومات عامة وليست تشخيصًا؛ القرار النهائي لمختص مؤهل."
      : "This is general information, not a diagnosis; a qualified clinician makes the final call.";
  const needsProfessionalReview = agent === "emergency" || severity === "urgent";

  const confidence: GatewayResult["body"]["confidence"] =
    safety.isEmergency || matched.length > 0 ? "high" : intent === "UNKNOWN" ? "medium" : "medium";

  return {
    status: result.status,
    body: {
      success: result.body.success,
      output: output || result.body.error || "",
      error: result.body.error,
      routedTo: agent,
      handoffFrom,
      intent,
      severity: agent === "emergency" ? severity : null,
      confidence,
      warnings: verification.warnings,
      needs_handoff: false, // handoff already completed through the router
      handoff_agent: null,
      provider,
      model,
      fallbackUsed,
      toolCalls,
      requestId,
      latencyMs,
      actions,
      uncertainty,
      needsProfessionalReview,
      verification: { result: verification.result, warnings: verification.warnings },
      agentVersion: AGENT_VERSION,
      policyVersion: SAFETY_RULES_VERSION,
      modelVersion: model,
      router: {
        mechanism: "AI Gateway: safety router → intent classifier → context builder → specialist → verification gate",
        rule,
        matched: matched.slice(0, 8),
        emergencyEscalationAppended: agent === "emergency",
        safetyResult,
      },
      // Conversation 2.0 (v5) — additive metadata.
      conversationId: conversation?.id ?? null,
      logId,
      cached,
      historyUsed: cached ? 0 : history.length,
    },
  };
}

/**
 * Wrap a DIRECT specialist endpoint (e.g. POST /api/agents/medical) so it
 * shares the same audit + handoff detection as the router path (§45 needs
 * per-agent stats for direct calls too). The agent still answers with its
 * own specialization; if its answer is a redirection, the response carries
 * needs_handoff + handoff_agent so the UI can offer the hop (§26).
 */
export async function wrapDirectAgentCall(
  agentKey: AgentKey,
  params: { input?: string; user?: { id?: string }; language?: string },
  handler: AnyHandler
): Promise<GatewayResult> {
  const started = Date.now();
  const requestId = randomUUID();
  const message = (params.input || "").slice(0, 2000);
  const language = params.language === "ar" ? "ar" : "en";

  // Safety: even a direct specialist call escalates when the message itself
  // is an emergency (§41 — the user must not be bounced between agents).
  const safety = safetyCheck(message);
  const effectiveAgent: AgentKey = safety.isEmergency ? "emergency" : agentKey;
  // MR-16 / G-01 central fix (2026-10-01): direct specialist calls are now
  // subject to the SAME daily budget as the gateway path — they previously
  // bypassed checkAiBudget entirely, so the per-user and global caps were
  // enforceable only through POST /api/agents. Emergency keeps its per-user
  // exemption (checkAiBudget returns cap 0 for it). Cache is absent here by
  // design (direct one-shots), so every call is a real provider call.
  const budgetUserId = params.user?.id || "unknown";
  const budget = checkAiBudget(budgetUserId, effectiveAgent);
  if (!budget.allowed) {
    console.warn(
      `[ai-gateway] AI_BUDGET_EXCEEDED (direct): user=${budgetUserId} agent=${effectiveAgent} reason=${budget.reason}`
    );
    return {
      status: 429,
      body: {
        success: false,
        error: "AI_BUDGET_EXCEEDED",
        output: "",
        routedTo: effectiveAgent,
        handoffFrom: null,
        intent: effectiveAgent === "medical" ? "MEDICAL_KNOWLEDGE" : effectiveAgent === "medicine" ? "MEDICATION" : effectiveAgent === "personal-health" ? "PERSONAL_HEALTH" : "EMERGENCY",
        severity: null,
        confidence: "high",
        warnings: [],
        needs_handoff: false,
        handoff_agent: null,
        provider: "none",
        model: "none",
        fallbackUsed: false,
        toolCalls: [],
        requestId,
        latencyMs: Date.now() - started,
        actions: [],
        uncertainty: "",
        needsProfessionalReview: false,
        verification: { result: "skipped", warnings: [] },
        agentVersion: AGENT_VERSION,
        policyVersion: SAFETY_RULES_VERSION,
        modelVersion: "none",
        router: {
          mechanism: "direct specialist call (budget guard)",
          rule: `budget:${budget.reason}`,
          matched: [],
          emergencyEscalationAppended: false,
          safetyResult: "ok",
        },
        conversationId: null,
        logId: null,
        cached: false,
        historyUsed: 0,
      },
    };
  }
  consumeAiBudget(budgetUserId, effectiveAgent);
  // OWNER REVIEW 2026-10-01: direct specialist calls now go through the SAME
  // authorized context builder as the router path (previously they bypassed
  // buildContext entirely, so POST /api/agents/medicine never received the
  // caller's medication list — even on explicit "أدويتي/my meds" questions).
  // Context failure is non-fatal: the agent answers without it.
  let contextText = "";
  let contextToolCalls: string[] = [];
  try {
    const built = await buildContext(effectiveAgent, params.user?.id || "", message);
    contextText = built.contextText;
    contextToolCalls = built.toolCalls;
  } catch { /* non-fatal */ }
  // Direct calls are stateless one-shots (no thread): history is empty and
  // the response honestly reports conversationId:null. The gateway path is
  // where Conversation 2.0 threading lives. Params are rebuilt explicitly
  // (never spread) so a client cannot inject `message`/`history`/`summary`.
  const result = await HANDLERS[effectiveAgent]({
    userId: params.user?.id,
    user: params.user,
    message: contextText + message,
    input: contextText + message,
    language,
    history: [],
    summary: "",
  });
  let output = result.body.output || "";

  // P0-26 — locale-aware escalation number (caller's stored timezone).
  let emergencyNumber = "your local emergency number";
  if (effectiveAgent === "emergency") {
    try {
      const caller = params.user?.id
        ? await db.user.findUnique({ where: { id: params.user.id }, select: { timeZone: true } })
        : null;
      emergencyNumber = localeEmergencyNumber(caller?.timeZone);
    } catch {
      /* best-effort */
    }
    output = ensureEscalationLine(output, language, emergencyNumber);
  }

  // P0-43 — the SAME verification gate protects direct specialist calls.
  const verification = verifyOutput(output, language);
  if (verification.correction) {
    output = output.trimEnd() + verification.correction;
  }

  let needsHandoff = false;
  let handoffAgent: AgentKey | null = null;
  if (effectiveAgent !== "emergency" && isHandoffMarker(output)) {
    const target = detectHandoffTarget(output);
    if (target && HANDOFF_TARGETS[effectiveAgent].includes(target)) {
      needsHandoff = true;
      handoffAgent = target;
    }
  }

  const provider = result.body.provider || "zai-glm";
  const model = result.body.model || providerModelLabel("zai" as ProviderName);
  const latencyMs = Date.now() - started;

  // §30/§32 — degraded reply when the whole provider chain is exhausted.
  if (!result.body.success) {
    output = degradedOutput(effectiveAgent, language);
  }

  const logId = await writeAiLog({
    requestId,
    userId: params.user?.id || "unknown",
    agent: effectiveAgent,
    provider,
    model,
    intent: safety.isEmergency
      ? "EMERGENCY"
      : effectiveAgent === "medical"
        ? "MEDICAL_KNOWLEDGE"
        : effectiveAgent === "medicine"
          ? "MEDICATION"
          : effectiveAgent === "personal-health"
            ? "PERSONAL_HEALTH"
            : "UNKNOWN",
    severity: effectiveAgent === "emergency" ? (safety.severity || "moderate") : null,
    fallbackUsed: provider === "zai-glm",
    handoff: needsHandoff,
    handoffFrom: null,
    safetyResult: (safety.isEmergency
      ? `emergency_priority:${safety.severity} (redirected from ${agentKey})`
      : "ok") + `|verify:${verification.result}`,
    toolCalls: contextToolCalls,
    latencyMs,
    success: Boolean(result.body.success && output),
    inputPreview: message,
    answerLength: output.length,
  });

  return {
    status: result.status,
    body: {
      success: result.body.success,
      output: output || result.body.error || "",
      error: result.body.error,
      routedTo: effectiveAgent,
      handoffFrom: safety.isEmergency && effectiveAgent !== agentKey ? agentKey : null,
      intent: effectiveAgent === "medical" ? "MEDICAL_KNOWLEDGE" : effectiveAgent === "medicine" ? "MEDICATION" : effectiveAgent === "personal-health" ? "PERSONAL_HEALTH" : "EMERGENCY",
      severity: effectiveAgent === "emergency" ? (safety.severity || "moderate") : null,
      confidence: "high",
      warnings: verification.warnings,
      needs_handoff: needsHandoff,
      handoff_agent: handoffAgent,
      provider,
      model,
      fallbackUsed: provider === "zai-glm",
      toolCalls: contextToolCalls,
      requestId,
      latencyMs,
      actions:
        effectiveAgent === "emergency"
          ? [
              language === "ar"
                ? `اتصل بالرقم ${emergencyNumber} الآن إن كانت الأعراض شديدة.`
                : `Call ${emergencyNumber} now if the symptoms are severe.`,
            ]
          : [],
      uncertainty:
        language === "ar"
          ? "هذه معلومات عامة وليست تشخيصًا؛ القرار النهائي لمختص مؤهل."
          : "This is general information, not a diagnosis; a qualified clinician makes the final call.",
      needsProfessionalReview: effectiveAgent === "emergency" || safety.severity === "urgent",
      verification: { result: verification.result, warnings: verification.warnings },
      agentVersion: AGENT_VERSION,
      policyVersion: SAFETY_RULES_VERSION,
      modelVersion: model,
      router: {
        mechanism: "direct specialist call (safety-verified + audited)",
        rule: safety.isEmergency ? "emergency override" : `direct:${agentKey}`,
        matched: safety.matched.slice(0, 8),
        emergencyEscalationAppended: effectiveAgent === "emergency",
        safetyResult: safety.isEmergency ? "emergency_priority" : "ok",
      },
      // Conversation 2.0 (v5) — direct one-shot calls carry the same additive
      // metadata shape as the gateway (no thread → conversationId null).
      conversationId: null,
      logId,
      cached: false,
      historyUsed: 0,
    },
  };
}

/** Exposed for the monitoring endpoint: current per-agent chain config. */
export function agentChainConfig(): Record<string, string[]> {
  return {
    router: resolveChain("router").map(providerLabel),
    medical: resolveChain("medical").map(providerLabel),
    medicine: resolveChain("medicine").map(providerLabel),
    "personal-health": resolveChain("personal").map(providerLabel),
    emergency: resolveChain("emergency").map(providerLabel),
    vision: resolveChain("vision").map(providerLabel),
  };
}

export { AGENTS };
// Re-exported for the direct specialist routes (they already imported it
// from here; making it explicit also satisfies strict type-checking).
export type { AgentKey };
