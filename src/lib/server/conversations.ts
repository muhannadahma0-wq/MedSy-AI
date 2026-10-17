/**
 * Conversation 2.0 service (v5 review item: per-conversation, DB-backed
 * threads for the AI agents).
 *
 * Replaces the OLD design where every agent module kept an in-process
 * `Map<userId, ConversationSummaryMemory>`:
 *   - OLD: memory keyed ONLY by userId → cross-CONVERSATION contamination
 *     (two chats in different tabs shared one summary), lost on every
 *     restart/HMR, and the `Conversation` table was a flat request log.
 *   - NEW: each thread is a Prisma `Conversation` row owned by
 *     (userId, thread id) with messages stored as a JSON string
 *     (Prisma primitive lists are not allowed on SQLite), a lazily
 *     maintained rolling summary, and a soft-archive `active` flag.
 *
 * Data-minimization / security rules enforced HERE (not in prompts):
 *   - every read/write is scoped by `userId` (ownership is checked on the
 *     WHERE clause, never after the fact — a foreign conversationId is
 *     simply "not found", never leaked);
 *   - message content is capped at 8000 chars per message;
 *   - the stored thread is the ONLY long-term conversational memory; the
 *     prompt gets the most recent `limit` turns + a short summary.
 *
 * The summary is maintained SYNCHRONOUSLY and cheaply (naive truncation
 * join) — there is deliberately NO LLM in this path, so a summarizer
 * outage can never break the chat.
 */

import { db } from "@/lib/db";
import type { AgentKey } from "@/lib/server/ai/agent-registry";

/** The four specialist agents that own conversation threads. */
export const CONVERSATION_AGENTS: AgentKey[] = ["medical", "medicine", "personal-health", "emergency"];

export function isValidConversationAgent(agent: string): agent is AgentKey {
  return (CONVERSATION_AGENTS as string[]).includes(agent);
}

// ---------------------------------------------------------------------------
// Message storage helpers
// ---------------------------------------------------------------------------

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  /** ISO timestamp of when the message was appended. */
  at: string;
  /** Agent that produced an assistant message (threads can span agents). */
  agent?: string;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGE_CHARS = 8000;
const MAX_STORED_MESSAGES = 200;
/** When stored messages exceed this, the oldest half is folded into `summary`. */
const SUMMARY_FOLD_THRESHOLD = 60;
/** Keep the carried-over part of an existing summary short. */
const SUMMARY_CARRY_CHARS = 400;
/** Cap on the folded "earlier turns" note. */
const SUMMARY_FOLD_CHARS = 1200;
const HISTORY_DEFAULT_LIMIT = 16;

function sanitizeContent(content: string): string {
  return String(content || "").slice(0, MAX_MESSAGE_CHARS);
}

function parseMessages(raw: string | null | undefined): StoredMessage[] {
  if (!raw) return [];
  try {
    // Defensive: accept both the raw JSON string (Prisma row) and an
    // already-parsed array (in-memory caller).
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is StoredMessage =>
        m && typeof m === "object" && typeof m.content === "string" &&
        (m.role === "user" || m.role === "assistant")
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Conversation row type (mirrors the Prisma model; messages stays raw JSON)
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string;
  userId: string;
  agent: string;
  title: string;
  messages: string;
  summary: string;
  language: string;
  messageCount: number;
  promptVersion: string;
  modelVersion: string;
  provider: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Core service functions
// ---------------------------------------------------------------------------

/**
 * Load (or create) the caller's conversation thread.
 *
 * Lookup rule: `WHERE id = conversationId AND userId AND active = true` —
 * no agent filter, because one thread may legitimately span agents (a
 * follow-up in a "medical" thread can be routed to "medicine" by the
 * gateway; the per-message `agent` field records who answered). When the
 * provided conversationId belongs to ANOTHER USER, is archived, or does
 * not exist, it is ignored and a fresh thread is created — a foreign id
 * must never be readable or writable through this path.
 */
export async function getOrCreateConversation(
  userId: string,
  agent: AgentKey,
  conversationId?: string,
  language: "ar" | "en" = "en"
): Promise<ConversationRow> {
  if (conversationId) {
    const existing = await db.conversation.findFirst({
      where: { id: conversationId, userId, active: true },
    });
    if (existing) return existing as unknown as ConversationRow;
    // Not owned / archived / unknown → fall through and create a new one.
  }
  const created = await db.conversation.create({
    data: {
      userId,
      agent,
      language,
      title: "",
      messages: "[]",
      summary: "",
      messageCount: 0,
    },
  });
  return created as unknown as ConversationRow;
}

/**
 * The most recent `limit` turns (oldest → newest) for prompt injection.
 */
export function loadHistory(conversation: ConversationRow, limit = HISTORY_DEFAULT_LIMIT): HistoryTurn[] {
  const messages = parseMessages(conversation.messages);
  if (messages.length === 0) return [];
  const window = messages.slice(-Math.max(1, limit));
  return window.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Short summary note the gateway can inject as "Conversation so far".
 * Empty string when no summary exists (most threads never need one).
 */
export function getSummaryForPrompt(conversation: ConversationRow): string {
  const summary = (conversation.summary || "").trim();
  if (!summary) return "";
  return summary.slice(0, 600);
}

export interface AppendExchangeMeta {
  agent: string;
  language: "ar" | "en";
  provider: string;
  modelVersion: string;
  promptVersion: string;
}

/**
 * Append one user + assistant exchange to the thread.
 *
 * - both messages are stored with timestamps (assistant message carries the
 *   answering agent);
 * - `messageCount` follows the STORED array (after any folding/capping);
 * - the title is set once, from the first user message (max 60 chars);
 * - when stored messages exceed SUMMARY_FOLD_THRESHOLD, the oldest half is
 *   folded into `summary` by a naive truncation join (first 400 chars of the
 *   existing summary + a compacted note) — synchronous, no LLM involved;
 * - the stored array is capped at MAX_STORED_MESSAGES (oldest dropped).
 */
export async function appendExchange(
  conversationId: string,
  userId: string,
  userMsg: string,
  assistantMsg: string,
  meta: AppendExchangeMeta
): Promise<void> {
  // Ownership re-checked on the WHERE clause (never trust a passed row).
  const row = await db.conversation.findFirst({
    where: { id: conversationId, userId, active: true },
  });
  if (!row) return; // archived concurrently or foreign — drop silently

  const now = new Date().toISOString();
  let messages = parseMessages(row.messages);
  messages.push({ role: "user", content: sanitizeContent(userMsg), at: now });
  messages.push({
    role: "assistant",
    content: sanitizeContent(assistantMsg),
    at: now,
    agent: meta.agent,
  });

  // Lazy summary maintenance: fold the oldest half into the rolling summary.
  let summary = row.summary || "";
  if (messages.length > SUMMARY_FOLD_THRESHOLD) {
    const foldCount = Math.floor(messages.length / 2);
    const older = messages.slice(0, foldCount);
    messages = messages.slice(foldCount);
    const folded = older
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join(" | ")
      .slice(0, SUMMARY_FOLD_CHARS);
    const carry = summary.slice(0, SUMMARY_CARRY_CHARS);
    summary = `${carry ? carry + " | " : ""}Earlier turns: ${folded}`.slice(0, 2000);
  }

  // Hard cap on stored messages (oldest dropped; the summary keeps context).
  if (messages.length > MAX_STORED_MESSAGES) {
    messages = messages.slice(messages.length - MAX_STORED_MESSAGES);
  }

  const title = row.title
    ? row.title
    : String(userMsg || "").trim().slice(0, 60);

  await db.conversation.update({
    where: { id: row.id },
    data: {
      messages: JSON.stringify(messages),
      summary,
      title,
      messageCount: messages.length,
      language: meta.language,
      provider: meta.provider,
      modelVersion: meta.modelVersion,
      promptVersion: meta.promptVersion,
      updatedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Listing / retrieval / archiving (all ownership-scoped)
// ---------------------------------------------------------------------------

export interface ConversationListItem {
  id: string;
  agent: string;
  title: string;
  messageCount: number;
  language: string;
  updatedAt: Date;
  createdAt: Date;
}

/** Active conversations for (userId, agent), most recently updated first. */
export async function listConversations(
  userId: string,
  agent: AgentKey
): Promise<ConversationListItem[]> {
  const rows = await db.conversation.findMany({
    where: { userId, agent, active: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      agent: true,
      title: true,
      messageCount: true,
      language: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  return rows as ConversationListItem[];
}

export interface ConversationDetail {
  id: string;
  agent: string;
  title: string;
  language: string;
  messageCount: number;
  summary: string;
  messages: StoredMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/** Full thread (parsed messages) — ownership enforced; null when not owned. */
export async function getConversation(
  userId: string,
  id: string
): Promise<ConversationDetail | null> {
  const row = await db.conversation.findFirst({
    where: { id, userId, active: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    agent: row.agent,
    title: row.title,
    language: row.language,
    messageCount: row.messageCount,
    summary: row.summary,
    messages: parseMessages(row.messages),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Soft-archive (delete = active:false). Returns false when not owned. */
export async function archiveConversation(userId: string, id: string): Promise<boolean> {
  const result = await db.conversation.updateMany({
    where: { id, userId, active: true },
    data: { active: false },
  });
  return result.count > 0;
}
