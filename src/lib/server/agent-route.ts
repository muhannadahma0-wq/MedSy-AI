/**
 * POST /api/agents/* — ports of the four agent handlers
 * (medical_model.js, emergency_model.js, medicine_model.js,
 * personal_health_model.js). Prompts are the originals, verbatim.
 */
import { json, readJson } from "@/lib/server/http";
import { runAgent, type AgentModel } from "@/lib/server/agents";

export interface AgentBody {
  input?: string;
  user?: { id?: string };
  localuser?: { id?: string };
  /** UI language of the client — when "ar" the agent answers in Arabic. */
  language?: string;
}

export async function handleAgentRequest(req: Request, model: AgentModel) {
  const body = await readJson<AgentBody>(req);
  const input = body.input || "What is my medical status ?";
  const user = body.user || body.localuser;
  if (!user || !user.id) {
    return json({ success: false, error: "User data is required in request body" }, 400);
  }
  const language = body.language === "ar" ? "ar" : "en";
  const result = await runAgent(model, input, { id: user.id }, language);
  return json(result.body, result.status);
}
