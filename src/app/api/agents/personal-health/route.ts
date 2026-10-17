/** POST /api/agents/personal-health — the Personal Health specialist (own chain) */
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import {
  personalHealthModelHandler,
  type PersonalHealthModelParams,
} from "@/lib/server/models/personal-health-model";
import { wrapDirectAgentCall, type AgentKey } from "@/lib/server/ai/gateway";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  // Phase 12 — the agent answers as the AUTHENTICATED caller; any body
  // identity is overridden by the verified one.
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const body = await readJson<PersonalHealthModelParams>(req);
  body.user = { id: guard.id };
  // AI-architecture spec §26/§41/§45: direct calls share the gateway's
  // safety verification (emergency override), handoff detection and
  // AiLog audit. The agent keeps its own specialization + provider chain.
  const result = await wrapDirectAgentCall("personal-health" as AgentKey, body, personalHealthModelHandler);
  return json(result.body, result.status);
}

export const POST = withMetrics("POST /api/agents/personal-health", handler_POST);
