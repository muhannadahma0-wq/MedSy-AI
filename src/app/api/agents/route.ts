/**
 * POST /api/agents — AI GATEWAY (spec §53): the single conversational entry.
 *
 * Pipeline (all server-side, deterministic where it matters):
 *   Safety Router → Intent Classifier → Context Builder (permitted tools
 *   only) → Specialist Agent (per-agent module, own prompt/memory) →
 *   Output Validator (handoff through the router, escalation guarantee,
 *   severity tier) → AiLog (data-minimized audit).
 *
 * The classifier and safety vocabulary are rule-based on purpose:
 *  - auditable: every routing decision returns the keywords that drove it;
 *  - prompt-injection-proof: routing never runs LLM output through more LLM
 *    logic — a crafted message can at worst reach a wrong *documented* agent
 *    scope, never an undocumented one;
 *  - testable: pure keyword sets, no model dependency (§47-48 test suites).
 *
 * Backward compatibility: `output`, `routedTo` and `router` keep their
 * Phase-8 shapes; everything else is additive structured metadata (§28).
 */
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { runGateway } from "@/lib/server/ai/gateway";
import type { AgentKey } from "@/lib/server/ai/agent-registry";
import { withMetrics } from "@/lib/server/metrics";

const VALID_AGENTS: AgentKey[] = ["medical", "medicine", "personal-health", "emergency"];

async function handler_POST(req: Request) {
  // Phase 12 — the gateway answers as the AUTHENTICATED caller; any body
  // identity is overridden by the verified one (also the tool-layer
  // authorization key, §10).
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const body = await readJson<{
    input?: string;
    language?: string;
    /** UI-selected specialist — a HINT; safety always wins (§50). */
    preferredAgent?: string;
    /** Conversation 2.0 — thread to continue (foreign ids are ignored). */
    conversationId?: string;
  }>(req);

  const message = (body.input || "").toString().slice(0, 2000);
  if (!message.trim()) {
    return json({ success: false, error: "Message text is required (input)" }, 400);
  }
  const language = body.language === "ar" ? "ar" : "en";
  const preferred = VALID_AGENTS.includes(body.preferredAgent as AgentKey)
    ? (body.preferredAgent as AgentKey)
    : undefined;
  const conversationId =
    typeof body.conversationId === "string" &&
    body.conversationId.length > 0 &&
    body.conversationId.length <= 64
      ? body.conversationId
      : undefined;

  const result = await runGateway({
    message,
    userId: guard.id,
    language,
    preferredAgent: preferred,
    conversationId,
  });

  return json(result.body, result.status);
}

export const POST = withMetrics("POST /api/agents (AI Gateway)", handler_POST);
