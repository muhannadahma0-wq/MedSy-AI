/**
 * POST /api/agents/feedback — AI feedback loop (v5 review item 38 / addition H).
 *
 * The caller rates an agent answer 👍 helpful / 👎 unhelpful / ⚠️ unsafe.
 * Ratings feed the AI-quality dataset (aggregated per agent in
 * /api/ai-monitoring and /api/research/overview) without storing any
 * additional personal information beyond the caller's id.
 *
 * Contract:
 *   body { agent: "medical"|"medicine"|"personal-health"|"emergency"|"router",
 *          rating: "helpful"|"unhelpful"|"unsafe",
 *          aiLogId?: string (cuid-shaped, ≤64 chars),
 *          conversationId?: string (cuid-shaped, ≤64 chars),
 *          comment?: string (≤500 chars, stripped) }
 *
 * Upsert semantics — one vote per answer: when the same (userId, aiLogId)
 * feedback already exists, the rating/comment are UPDATED (changing your
 * mind is allowed, ballot-stuffing is not). Submissions without an aiLogId
 * are plain inserts (no answer to key on).
 */
import { db } from "@/lib/db";
import { json, readJson, apiError } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { hitRateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/** 30 feedback submissions / 10 minutes per user (same pattern as LIMITS.upload). */
const FEEDBACK_LIMIT = { windowMs: 600_000, max: 30 };

const ALLOWED_AGENTS = new Set([
  "medical",
  "medicine",
  "personal-health",
  "emergency",
  "router",
]);

const ALLOWED_RATINGS = new Set(["helpful", "unhelpful", "unsafe"]);

const MAX_COMMENT_CHARS = 500;
/** AiLog / Conversation ids are cuids: "c" + lowercase alphanumerics. */
const CUID_SHAPE = /^c[0-9a-z]{8,63}$/;

interface FeedbackBody {
  agent?: unknown;
  rating?: unknown;
  aiLogId?: unknown;
  conversationId?: unknown;
  comment?: unknown;
}

function parseOptionalId(value: unknown, field: string): string | null | Response {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !CUID_SHAPE.test(value)) {
    return apiError(
      "VALIDATION_ERROR",
      `Invalid ${field} — expected a cuid-shaped identifier of at most 64 characters.`
    );
  }
  return value;
}

async function handler_POST(req: Request) {
  // BOLA guard — feedback is always recorded for the verified caller.
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  // Feedback flood guard (one row per hit, keyed on the caller).
  const decision = hitRateLimit(`agent-feedback:user:${userId}`, FEEDBACK_LIMIT);
  if (!decision.allowed) {
    return tooManyRequests(
      decision.retryAfterMs,
      "Too many feedback submissions. Please wait a few minutes and try again."
    );
  }

  const body = await readJson<FeedbackBody>(req);

  // ── Validation (closed sets, bounded lengths) ────────────────────────────
  const agent = body.agent;
  if (typeof agent !== "string" || !ALLOWED_AGENTS.has(agent)) {
    return apiError(
      "VALIDATION_ERROR",
      "Invalid agent — must be one of medical, medicine, personal-health, emergency, router."
    );
  }
  const rating = body.rating;
  if (typeof rating !== "string" || !ALLOWED_RATINGS.has(rating)) {
    return apiError(
      "VALIDATION_ERROR",
      "Invalid rating — must be one of helpful, unhelpful, unsafe."
    );
  }

  let comment = "";
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== "string") {
      return apiError("VALIDATION_ERROR", "Invalid comment — must be a string.");
    }
    comment = body.comment.trim();
    if (comment.length > MAX_COMMENT_CHARS) {
      return apiError(
        "VALIDATION_ERROR",
        `Invalid comment — must be at most ${MAX_COMMENT_CHARS} characters.`
      );
    }
  }

  const aiLogIdOrError = parseOptionalId(body.aiLogId, "aiLogId");
  if (aiLogIdOrError instanceof Response) return aiLogIdOrError;
  const aiLogId = aiLogIdOrError;

  const conversationIdOrError = parseOptionalId(body.conversationId, "conversationId");
  if (conversationIdOrError instanceof Response) return conversationIdOrError;
  const conversationId = conversationIdOrError;

  try {
    // ── Upsert: one vote per (userId, aiLogId) answer ──────────────────────
    let updated = false;
    let saved;
    if (aiLogId) {
      const existing = await db.aiFeedback.findFirst({ where: { userId, aiLogId } });
      if (existing) {
        updated = true;
        saved = await db.aiFeedback.update({
          where: { id: existing.id },
          data: { rating, comment },
        });
      }
    }
    if (!saved) {
      saved = await db.aiFeedback.create({
        data: { userId, agent, rating, comment, aiLogId, conversationId },
      });
    }

    return json(
      { success: true, updated, feedback: { id: saved.id, rating: saved.rating } },
      updated ? 200 : 201
    );
  } catch (error) {
    console.error("[agents/feedback] internal error:", (error as Error).message);
    return apiError("INTERNAL_ERROR", "Could not save feedback. Please try again.");
  }
}

export const POST = withMetrics("POST /api/agents/feedback", handler_POST);
