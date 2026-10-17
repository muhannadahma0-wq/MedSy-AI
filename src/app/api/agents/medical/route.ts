/** POST /api/agents/medical — the Medical Knowledge specialist (own chain) */
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { medicalModelHandler, type MedicalModelParams } from "@/lib/server/models/medical-model";
import { wrapDirectAgentCall, type AgentKey } from "@/lib/server/ai/gateway";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  // Phase 12 — the agent answers as the AUTHENTICATED caller; any body
  // identity is overridden by the verified one.
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  const body = await readJson<MedicalModelParams>(req);
  body.user = { id: guard.id };
  // AI-architecture spec §26/§41/§45: direct calls share the gateway's
  // safety verification (emergency override), handoff detection and
  // AiLog audit. The agent keeps its own specialization + provider chain.
  const result = await wrapDirectAgentCall("medical" as AgentKey, body, medicalModelHandler);
  return json(result.body, result.status);
}

export const POST = withMetrics("POST /api/agents/medical", handler_POST);
