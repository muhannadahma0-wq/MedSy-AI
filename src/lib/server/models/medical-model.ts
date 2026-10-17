/**
 * The Medical Knowledge agent (port of utils/medical_model.js).
 *
 * Conversation 2.0 refactor (v5 review, P0): the module-level
 * `Map<userId, ConversationSummaryMemory>` and the legacy
 * `db.conversation.create(...)` request-log writes are GONE —
 *   - conversational memory is now a DB-backed per-CONVERSATION thread
 *     (src/lib/server/conversations.ts), injected here as `history` turns
 *     plus a short `summary` note by the gateway;
 *   - the AiLog row written by the gateway is the audit record.
 *
 * The agent KEEPS its own specialized prompt (verbatim below) and its OWN
 * provider-chain configuration (env `MEDICAL_PRIMARY/SECONDARY/FALLBACK`,
 * §54) — per-agent separation is a hard architectural requirement, so this
 * module is deliberately self-contained and is NOT merged into a shared
 * llm.ts. Vendor SDK coupling was removed: the call goes through
 * `runProviderChain("medical", ...)` (§30 — a fallback re-sends the SAME
 * agent prompt to a different provider).
 *
 * Per-agent model override preserved from the original architecture
 * (MEDICAL_CHAT_MODEL, Groq-scoped as before); when unset each provider in
 * the chain uses its own default model.
 */

import { runProviderChain, providerLabel, type ProviderMessage } from "@/lib/server/ai/providers";

const CHAIN_KEY = "medical" as const;
// MASTER AUDIT P0-17/P0-18 — per-agent model id, env-overridable (config
// change, never a code change). Applied when explicitly set; otherwise the
// provider chain resolves each provider's own default.
const CHAT_MODEL_OVERRIDE = process.env.MEDICAL_CHAT_MODEL || "";
const DEFAULT_INPUT = "What is my medical status ?";

// prompt — verbatim from the original (directives part)
const AGENT_PROMPT = `
      You are an AI assistant designed to provide general medical and health-related knowledge. Your role is to be a first point of contact for informational queries.
      Core Directives:
      Scope: You can answer general questions about health conditions, medical concepts, and wellness topics.
      Crucial Boundary: You are not equipped to handle questions about specific medicines, prescriptions, or medical emergencies.
      Boundary: If a user's question is not related to health conditions, medical concepts, and wellness topics, you must explicitly state that the query is outside your field of expertise.
      Redirection Protocol: If a user asks about a specific drug (e.g., "What is the dose for Paracetamol?") or describes an emergency situation, you must not answer. Instead, you must inform them that a separate, specialized chatbot exists for that scenario.
      Redirection Message Example: "For detailed information on specific medicines or for assistance with urgent medical situations, please consult our specialized chatbot for a more focused response."
      Response structure: answer the question directly first, then add short
      structured detail (brief points or a short list) only when it genuinely
      helps the patient. State uncertainty honestly when something is not
      settled, and recommend discussing significant findings with a qualified
      clinician when appropriate.
      Absolute prohibitions: no personal diagnosis, no medication adjustments,
      no emergency decisions, no adherence statistics. (لا تشخيص شخصي، لا تعديل
      أدوية، لا قرارات طوارئ، لا إحصاءات التزام.)
`;

const ARABIC_RESPONSE_INSTRUCTION = `
      LANGUAGE INSTRUCTION: Respond in clear, simple Modern Standard Arabic (العربية الفصحى) suitable for a general patient.
      Keep medication and drug names in both Arabic and Latin/English script where helpful.
      Keep the same conciseness rules defined above.
`;

/** Conversation 2.0 parameters (gateway) — with legacy aliases kept for the
 *  direct specialist routes and the vision pipeline. */
export interface MedicalModelParams {
  /** Verified caller id (requireSelf) — required for the new contract. */
  userId?: string;
  /** Current user message (new contract). */
  message?: string;
  /** UI language — "ar" makes the agent answer in Arabic. */
  language?: string;
  /** Conversation 2.0 history turns (oldest → newest) for this thread. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Short rolling-summary note for long threads (may be empty). */
  summary?: string;
  /** LEGACY: current message (aliases `message`). */
  input?: string;
  /** LEGACY: caller identity (aliases `userId`). */
  user?: { id?: string };
  /** LEGACY: caller identity (aliases `userId`). */
  localuser?: { id?: string };
}

export interface AgentHandlerResult {
  status: number;
  body: {
    success: boolean;
    output?: string;
    /** Same as `output` (explicit text alias for the Conversation 2.0 contract). */
    text?: string;
    error?: string;
    provider?: string;
    model?: string;
    latencyMs?: number;
    fallbackUsed?: boolean;
  };
}

/** Build the specialized system prompt (+ rolling-summary note when present). */
function buildSystemPrompt(arabic: boolean, summary?: string): string {
  const directives = (arabic ? AGENT_PROMPT + ARABIC_RESPONSE_INSTRUCTION : AGENT_PROMPT).trim();
  const note = (summary || "").trim();
  return note
    ? `${directives}\n\nConversation so far (summary): ${note}`
    : directives;
}

/** Per-agent execution: same specialized prompt, env-configured chain. */
async function runMedicalAgent(params: MedicalModelParams): Promise<AgentHandlerResult> {
  const userId = params.userId || params.user?.id || params.localuser?.id;
  if (!userId) {
    return { status: 400, body: { success: false, error: "User data is required in request body" } };
  }
  const message = String(params.message || params.input || DEFAULT_INPUT).slice(0, 8000);
  const arabic = params.language === "ar";
  const history = (Array.isArray(params.history) ? params.history : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-16);

  const messages: ProviderMessage[] = [
    { role: "system", content: buildSystemPrompt(arabic, params.summary) },
    ...history.map((t) => ({ role: t.role, content: t.content.slice(0, 8000) })),
    { role: "user", content: message },
  ];

  const result = await runProviderChain(
    CHAIN_KEY,
    messages,
    CHAT_MODEL_OVERRIDE
      ? { temperature: 0, model: CHAT_MODEL_OVERRIDE }
      : { temperature: 0 }
  );

  return {
    status: 200,
    body: {
      success: true,
      output: result.output,
      text: result.output,
      provider: providerLabel(result.provider),
      model: result.model,
      latencyMs: result.latencyMs,
      fallbackUsed: result.fallbackUsed,
    },
  };
}

export async function medicalModelHandler(params: MedicalModelParams): Promise<AgentHandlerResult> {
  try {
    return await runMedicalAgent(params);
  } catch (err) {
    console.error("medicalModelHandler error:", err);
    return { status: 500, body: { success: false, error: (err as Error).message } };
  }
}
