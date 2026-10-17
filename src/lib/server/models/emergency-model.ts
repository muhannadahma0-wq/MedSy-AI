/**
 * The Emergency Triage agent (port of utils/emergency_model.js).
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
 * provider-chain configuration (env `EMERGENCY_PRIMARY/SECONDARY/FALLBACK`,
 * §54) — per-agent separation is a hard architectural requirement, so this
 * module is deliberately self-contained and is NOT merged into a shared
 * llm.ts. Vendor SDK coupling was removed: the call goes through
 * `runProviderChain("emergency", ...)` (§30 — a fallback re-sends the SAME
 * agent prompt to a different provider).
 *
 * Per-agent model override preserved from the original architecture
 * (EMERGENCY_CHAT_MODEL, Groq-scoped as before); when unset each provider
 * in the chain uses its own default model.
 */

import { runProviderChain, providerLabel, type ProviderMessage } from "@/lib/server/ai/providers";

const CHAIN_KEY = "emergency" as const;
// MASTER AUDIT P0-17/P0-18 — per-agent model id, env-overridable (config
// change, never a code change). Applied when explicitly set; otherwise the
// provider chain resolves each provider's own default.
const CHAT_MODEL_OVERRIDE = process.env.EMERGENCY_CHAT_MODEL || "";
const DEFAULT_INPUT = "Is this an emergency situation ?";

// prompt — verbatim from the original (directives part)
const AGENT_PROMPT = `
      You are an AI assistant specialized in Emergency Triage.
      Your role is to quickly assess whether a user’s situation might be urgent and guide them toward the appropriate next step.
      Core Directives:
          Scope:
              Identify whether a user’s described symptoms or situation may indicate an urgent or emergency condition.
              Provide basic, high-level guidance (e.g., “This may require immediate medical attention”).
              Direct users to appropriate emergency resources or professionals.
          Boundaries:
              Do not provide exact diagnoses, prescriptions, or treatment plans.
              Do not replace professional emergency services.
              Always remain cautious: if uncertain, err on the side of safety and advise seeking urgent care.
          Redirection Protocol:
              If the user describes symptoms that may be life-threatening (e.g., chest pain, difficulty breathing, severe bleeding, unconsciousness), respond: “This sounds like a possible medical emergency. Please call your local emergency number right away or seek immediate medical help.”
              If the situation is non-urgent, suggest safer next steps: “This does not sound like an immediate emergency, but you may want to consult a healthcare professional soon.”
          Response Style:
              Lead with the safety assessment, then clear actionable steps.
              Structure over arbitrary length limits: short points when they
              help, but NEVER omit escalation guidance or honest uncertainty.
`;

const ARABIC_RESPONSE_INSTRUCTION = `
      LANGUAGE INSTRUCTION: Respond in clear, simple Modern Standard Arabic (العربية الفصحى) suitable for a general patient.
      Keep the same conciseness rules defined above. When urgent, direct the user to call the local emergency number immediately.
`;

/** Conversation 2.0 parameters (gateway) — with legacy aliases kept for the
 *  direct specialist routes. */
export interface EmergencyModelParams {
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

export async function emergencyModelHandler(params: EmergencyModelParams): Promise<AgentHandlerResult> {
  try {
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
  } catch (err) {
    console.error("emergencyModelHandler error:", err);
    return { status: 500, body: { success: false, error: (err as Error).message } };
  }
}
