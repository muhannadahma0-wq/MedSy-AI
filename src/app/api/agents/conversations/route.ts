/**
 * /api/agents/conversations — Conversation 2.0 thread management (v5 review).
 *
 *   GET    ?agent=medical|medicine|personal-health|emergency
 *          → the caller's active threads for that agent (updatedAt desc).
 *   GET    ?id=<conversationId>
 *          → one full thread (parsed messages) — ownership enforced.
 *   DELETE ?id=<conversationId>
 *          → soft archive (active:false) — ownership enforced.
 *
 * House style: same helpers (json, requireSelf, withMetrics) and response
 * envelope ({success, ...}) as the sibling agent routes; every query is
 * scoped to the VERIFIED caller, so a foreign conversation id is simply a
 * 404 (never a leak).
 */
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import {
  listConversations,
  getConversation,
  archiveConversation,
  isValidConversationAgent,
} from "@/lib/server/conversations";
import { withMetrics } from "@/lib/server/metrics";

async function handler_GET(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  const agent = (url.searchParams.get("agent") || "").trim();

  if (id) {
    const conversation = await getConversation(userId, id);
    if (!conversation) {
      return json({ success: false, message: "Conversation not found" }, 404);
    }
    return json(
      {
        success: true,
        conversation: {
          id: conversation.id,
          agent: conversation.agent,
          title: conversation.title,
          language: conversation.language,
          messageCount: conversation.messageCount,
          summary: conversation.summary,
          messages: conversation.messages.map((m) => ({
            role: m.role,
            content: m.content,
            at: m.at,
            ...(m.agent ? { agent: m.agent } : {}),
          })),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      },
      200
    );
  }

  if (agent) {
    if (!isValidConversationAgent(agent)) {
      return json(
        {
          success: false,
          message: "Invalid agent — must be one of: medical, medicine, personal-health, emergency",
        },
        400
      );
    }
    const conversations = await listConversations(userId, agent);
    return json({ success: true, conversations }, 200);
  }

  return json(
    { success: false, message: "Provide ?agent=<medical|medicine|personal-health|emergency> or ?id=<conversationId>" },
    400
  );
}

async function handler_DELETE(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) {
    return json({ success: false, message: "Query parameter id is required" }, 400);
  }

  const archived = await archiveConversation(userId, id);
  if (!archived) {
    return json({ success: false, message: "Conversation not found" }, 404);
  }
  return json({ success: true }, 200);
}

export const GET = withMetrics("GET /api/agents/conversations", handler_GET);
export const DELETE = withMetrics("DELETE /api/agents/conversations", handler_DELETE);
