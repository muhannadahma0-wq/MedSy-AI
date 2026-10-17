/**
 * The Personal Health Tracker agent (port of utils/personal_health_model.js).
 *
 * Conversation 2.0 refactor (v5 review, P0): the module-level
 * `Map<userId, ConversationSummaryMemory>` and the legacy
 * `db.conversation.create(...)` request-log writes are GONE —
 *   - conversational memory is now a DB-backed per-CONVERSATION thread
 *     (src/lib/server/conversations.ts), injected here as `history` turns
 *     plus a short `summary` note by the gateway;
 *   - the AiLog row written by the gateway is the audit record.
 *
 * The agent KEEPS its own specialized prompt (verbatim below), its OWN
 * medication grounding (the caller's stored medications are read from the
 * DB and injected as a system note — original "Memory Handling" directive),
 * and its OWN provider-chain configuration (env
 * `PERSONAL_PRIMARY/SECONDARY/FALLBACK`, §54) — per-agent separation is a
 * hard architectural requirement, so this module is deliberately
 * self-contained and is NOT merged into a shared llm.ts. Vendor SDK
 * coupling was removed: the call goes through `runProviderChain("personal",
 * ...)` (§30 — a fallback re-sends the SAME agent prompt to a different
 * provider).
 *
 * Per-agent model override preserved from the original architecture
 * (PERSONAL_CHAT_MODEL, Groq-scoped as before); when unset each provider
 * in the chain uses its own default model.
 */

import { db } from "@/lib/db";
import { runProviderChain, providerLabel, type ProviderMessage } from "@/lib/server/ai/providers";

const CHAIN_KEY = "personal" as const;
// MASTER AUDIT P0-17/P0-18 — per-agent model id, env-overridable (config
// change, never a code change). Applied when explicitly set; otherwise the
// provider chain resolves each provider's own default.
const CHAT_MODEL_OVERRIDE = process.env.PERSONAL_CHAT_MODEL || "";
const DEFAULT_INPUT = "What is my medical status ?";

// prompt — verbatim from the original (directives part)
const AGENT_PROMPT = `
      You are an AI assistant specialized as a Personal Health Tracker.
      Your primary role is to help users log, track, and recall their health-related data such as exercise, diet, sleep, symptoms, and general wellness information.
      Core Directives:
        Scope:
          Assist users in tracking personal health activities (exercise, meals, hydration, medications stored in the database, symptoms, sleep, etc.).
          Provide general knowledge about health, wellness, and medical concepts.
          Summarize and recall previously stored user data from memory when requested.
        Crucial Boundaries:
          Do not provide medical prescriptions, dosages, or specific drug recommendations.
          Do not handle emergency cases.
          If asked about specific medicines, dosages, or urgent situations, redirect the user.
          ML risk predictions: when a [VERIFIED DATA ...] block contains STORED
          risk predictions, you may EXPLAIN them in plain language — you must
          NEVER recompute, alter, or override them, and never present your own
          risk numbers.
        Redirection Protocol:
          For medication-specific queries (e.g., "What dose of Paracetamol should I take?"), respond:"For detailed information on specific medicines or urgent medical situations, please consult our specialized medical chatbot or a qualified healthcare professional."
        Response Style:
          Answer directly first, then short structured detail when it helps.
          Use clear, simple language suitable for all users.
          State uncertainty honestly and recommend professional follow-up
          when the topic warrants it.
        Memory Handling:
          Always recall and leverage previously stored data from the database and conversation memory.
          When asked about available medications, retrieve from stored memory (userData) and present them concisely.
`;

const ARABIC_RESPONSE_INSTRUCTION = `
      LANGUAGE INSTRUCTION: Respond in clear, simple Modern Standard Arabic (العربية الفصحى) suitable for a general patient.
      Keep medication and drug names in both Arabic and Latin/English script where helpful.
      Keep the same conciseness rules defined above.
`;

/** Conversation 2.0 parameters (gateway) — with legacy aliases kept for the
 *  direct specialist routes. */
export interface PersonalHealthModelParams {
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

/**
 * The caller's stored medications (original grounding, read-only, scoped to
 * the verified userId — the module's own data source, kept from the
 * original "Memory Handling" behaviour).
 */
async function loadUserData(userId: string) {
  const meds = await db.medication.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      pillName: true,
      pillDescription: true,
      dosageAmount: true,
      frequency: true,
    },
  });
  return meds;
}

/** Build the specialized system prompt (+ rolling-summary note when present). */
function buildSystemPrompt(arabic: boolean, summary?: string, userDataNote?: string): string {
  const directives = (arabic ? AGENT_PROMPT + ARABIC_RESPONSE_INSTRUCTION : AGENT_PROMPT).trim();
  const parts: string[] = [directives];
  const note = (summary || "").trim();
  if (note) parts.push(`Conversation so far (summary): ${note}`);
  if (userDataNote) parts.push(userDataNote);
  return parts.join("\n\n");
}

export async function personalHealthModelHandler(
  params: PersonalHealthModelParams
): Promise<AgentHandlerResult> {
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

    // Medication grounding (original behaviour — non-fatal on failure).
    let userDataNote = "";
    try {
      const userData = await loadUserData(userId);
      if (userData.length > 0) {
        userDataNote =
          `These medications are available in the user's database (verified data — treat as ground truth):\n` +
          JSON.stringify(userData, null, 1).slice(0, 2000);
      }
    } catch (err) {
      console.warn("personal_health_model: medication grounding failed (non-fatal):", (err as Error).message);
    }

    const messages: ProviderMessage[] = [
      { role: "system", content: buildSystemPrompt(arabic, params.summary, userDataNote) },
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
    console.error("personalHealthModelHandler error:", err);
    return { status: 500, body: { success: false, error: (err as Error).message } };
  }
}
