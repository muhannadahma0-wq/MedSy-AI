/**
 * Agent Registry — capabilities matrix, tool permissions, handoff rules
 * (AI-architecture spec §19, §20-21, §25-26).
 *
 * This is the SINGLE SOURCE OF TRUTH, enforced in CODE (not only prompts):
 * the gateway consults it before every tool call and every handoff. A
 * prompt can ask an agent to behave; the registry makes it impossible for
 * the agent to reach data it must not reach.
 */

export type AgentKey = "medical" | "medicine" | "personal-health" | "emergency";
export type ToolName =
  | "getMedications"
  | "checkInteractions"
  | "getDoseHistory"
  | "getAdherenceSummary"
  | "getHealthProfile"
  | "getStoredRiskExplanation";

export interface AgentDefinition {
  key: AgentKey;
  display: { en: string; ar: string };
  /** Tools this agent may call — enforced by tools.ts (§20-21). */
  tools: ToolName[];
  /** Data scopes the agent may receive in its context (§36-37). */
  dataScopes: string[];
  /** What the agent must NOT do (mirrors the prompt boundaries). */
  forbidden: { en: string; ar: string };
}

/**
 * Capabilities matrix (spec §19, ✓ full / ~ limited / x none).
 * Mirrored in docs/AI_ARCHITECTURE.md — keep both in sync.
 */
export const CAPABILITIES_MATRIX = {
  columns: ["medical", "emergency", "medicine", "personal-health"] as const,
  rows: [
    { capability: "general_medical_knowledge", values: { medical: "full", emergency: "full", medicine: "limited", "personal-health": "limited" } },
    { capability: "medication_information", values: { medical: "limited", emergency: "full", medicine: "full", "personal-health": "limited" } },
    { capability: "drug_interaction", values: { medical: "none", emergency: "full", medicine: "full", "personal-health": "limited" } },
    { capability: "dose_schedule", values: { medical: "none", emergency: "none", medicine: "full", "personal-health": "full" } },
    { capability: "adherence_history", values: { medical: "none", emergency: "none", medicine: "none", "personal-health": "full" } },
    { capability: "user_health_profile", values: { medical: "none", emergency: "limited", medicine: "none", "personal-health": "full" } },
    { capability: "lab_report_explanation", values: { medical: "full", emergency: "full", medicine: "limited", "personal-health": "owner_only" } },
    { capability: "emergency_triage", values: { medical: "none", emergency: "full", medicine: "handoff", "personal-health": "handoff" } },
    { capability: "change_medication", values: { medical: "none", emergency: "none", medicine: "none", "personal-health": "none" } },
    { capability: "diagnose_disease", values: { medical: "none", emergency: "none", medicine: "none", "personal-health": "none" } },
  ],
} as const;

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  medical: {
    key: "medical",
    display: { en: "Medical Knowledge", ar: "المعرفة الطبية" },
    tools: [],
    dataScopes: [],
    forbidden: {
      en: "No personal diagnosis, no medication adjustments, no emergency decisions, no adherence statistics.",
      ar: "لا تشخيص شخصي، لا تعديل أدوية، لا قرارات طوارئ، لا إحصاءات التزام.",
    },
  },
  medicine: {
    key: "medicine",
    display: { en: "Medication Specialist", ar: "أخصائي الأدوية" },
    tools: ["getMedications", "checkInteractions"],
    dataScopes: ["medications", "schedule"],
    forbidden: {
      en: "No personal analytics, no emergency diagnosis, no prescription changes.",
      ar: "لا تحليلات شخصية، لا تشخيص طوارئ، لا تغيير وصفات.",
    },
  },
  "personal-health": {
    key: "personal-health",
    display: { en: "Personal Health", ar: "الصحة الشخصية" },
    tools: [
      "getMedications",
      "getDoseHistory",
      "getAdherenceSummary",
      "getHealthProfile",
      "getStoredRiskExplanation",
    ],
    dataScopes: ["dose_history", "medications", "health_profile", "ml_risk_explanations"],
    forbidden: {
      en: "Never alters or recomputes ML predictions — may only EXPLAIN stored ones. No other user's data, ever.",
      ar: "لا يغيّر ولا يعيد حساب تنبؤات ML — يشرح المخزّنة فقط. لا بيانات لمستخدم آخر مطلقاً.",
    },
  },
  emergency: {
    key: "emergency",
    display: { en: "Emergency Triage", ar: "فرز الطوارئ" },
    tools: ["getMedications", "checkInteractions"],
    dataScopes: ["medications"],
    forbidden: {
      en: "Risk classification + escalation ONLY. Never diagnoses, never treats, never reassures falsely.",
      ar: "تصنيف خطر وتصعيد فقط. لا يشخّص ولا يعالج ولا يطمئن زوراً.",
    },
  },
};

/** Which agent a handoff may target, per source agent (§24-26). */
export const HANDOFF_TARGETS: Record<AgentKey, AgentKey[]> = {
  medical: ["medicine", "emergency", "personal-health"],
  medicine: ["emergency", "personal-health", "medical"],
  "personal-health": ["medicine", "emergency", "medical"],
  emergency: [], // emergency never hands off — it is the top priority (§41)
};

/**
 * Redirection language the agents use when a question is outside their
 * scope (ported verbatim from the original prompts). The gateway detects
 * these markers to convert a textual redirect into a machine-readable
 * handoff (§6, §24-26).
 */
export const HANDOFF_MARKER_PATTERNS: RegExp[] = [
  /specialized chatbot/i,
  /specialized assistant/i,
  /personal health assistant/i,
  /route you to/i,
  /redirect(?:ing)? you/i,
  /outside (?:of )?(?:my|this) (?:field|scope|expertise)/i,
  /not (?:equipped|able) to (?:handle|answer)/i,
  /consult our specialized/i,
  /مساعد متخصص/i,
  /خارج نطاق تخصصي/i,
  /لا أستطيع (?:الإجابة|مساعدتك) في/i,
  /أحوّلك/i,
  /تحويلك/i,
];

/** Detect the handoff TARGET from an agent's redirection text (§26). */
export function detectHandoffTarget(answer: string): AgentKey | null {
  const t = answer.toLowerCase();
  const emergency = /emergency|urgent|911|immediate medical|طوارئ|عاجل|طارئ/;
  const medicine = /medication specialist|specific medicine|drug|dosage|dose of|أخصائي الأدوية|معلومات دوائية|الجرعة/;
  const personal = /personal health|adherence|your (?:medication )?history|الصحة الشخصية|الالتزام|سجلّك/;
  if (emergency.test(t)) return "emergency";
  if (medicine.test(t)) return "medicine";
  if (personal.test(t)) return "personal-health";
  return null;
}
