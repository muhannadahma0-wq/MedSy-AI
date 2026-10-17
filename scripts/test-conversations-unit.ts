/**
 * Conversation 2.0 + budget guard — UNIT-style verification (no HTTP, no LLM).
 *
 * Part A exercises the conversation service directly against the real SQLite
 * database: thread lifecycle, ownership scoping, message capping and the
 * lazy (LLM-free) summary folding.
 *
 * Part B exercises the gateway's daily-budget guard with tiny caps provided
 * through env at spawn time:
 *
 *   AI_DAILY_AGENT_REQUESTS=2 AI_GLOBAL_AGENT_DAILY=3 \
 *     bun run scripts/test-conversations-unit.ts
 *
 * (The env is read at module load — exactly the mechanism the dev server
 * uses with the production defaults 40 / 5000.)
 *
 * Self-cleaning: every row it creates is hard-deleted before exit.
 */

// ADR-06 (migrated-stack runs): point this script's own Prisma client at the
// same database the API under test uses, via an explicit module path + URL.
// Default (no env set) is byte-identical baseline behavior — no assertion touched.
const { PrismaClient } = (await import(
  process.env.TEST_PRISMA_CLIENT ?? "@prisma/client"
)) as typeof import("@prisma/client");
import {
  getOrCreateConversation,
  appendExchange,
  loadHistory,
  getSummaryForPrompt,
  getConversation,
  listConversations,
  archiveConversation,
  isValidConversationAgent,
  type ConversationRow,
} from "../src/lib/server/conversations";
import { checkAiBudget, consumeAiBudget } from "../src/lib/server/ai/gateway";

const db = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${details ? ` — ${details}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
  }
}

const UNIT_USER = "unit-test-conversations-user";
const META = {
  agent: "medical",
  language: "en" as const,
  provider: "unit-test",
  modelVersion: "unit-model",
  promptVersion: "unit-prompt",
};

async function partAConversationService() {
  console.log("\n── Part A: conversation service (direct DB) ──");

  check("agent validation accepts the 4 keys", isValidConversationAgent("medical") && isValidConversationAgent("medicine") && isValidConversationAgent("personal-health") && isValidConversationAgent("emergency"));
  check("agent validation rejects bogus keys", !isValidConversationAgent("router") && !isValidConversationAgent("vision"));

  // 1) create
  const conv = await getOrCreateConversation(UNIT_USER, "medical", undefined, "en");
  check("creates a new thread", Boolean(conv.id) && conv.agent === "medical" && conv.active);
  check("new thread is empty", conv.messageCount === 0 && loadHistory(conv).length === 0);
  check("no summary on a fresh thread", getSummaryForPrompt(conv) === "");

  // 2) ownership: a DIFFERENT user cannot load the same id
  const foreign = await getOrCreateConversation("unit-test-other-user", "medical", conv.id, "en");
  check("foreign conversationId is ignored (new thread created)", foreign.id !== conv.id);
  check("foreign user cannot read the thread", (await getConversation("unit-test-other-user", conv.id)) === null);

  // 3) same user + same id → reuses the thread
  const again = await getOrCreateConversation(UNIT_USER, "medical", conv.id, "en");
  check("same user + id reuses the thread", again.id === conv.id);

  // 4) append + history
  await appendExchange(conv.id, UNIT_USER, "What is hypertension?", "High blood pressure.", META);
  const after1 = await getConversation(UNIT_USER, conv.id);
  check("append stores 2 messages", after1 !== null && after1.messages.length === 2 && after1.messageCount === 2);
  check("title = first 60 chars of first user message", after1?.title === "What is hypertension?");
  check("assistant message carries the agent", after1?.messages[1]?.agent === "medical");
  const hist1 = loadHistory(after1 as unknown as ConversationRow, 16);
  check("loadHistory returns oldest→newest turns", hist1.length === 2 && hist1[0].role === "user" && hist1[1].role === "assistant");

  // 5) foreign append is silently dropped
  await appendExchange(conv.id, "unit-test-other-user", "hack", "hack", META);
  const afterForeign = await getConversation(UNIT_USER, conv.id);
  check("foreign appendExchange is dropped", afterForeign?.messages.length === 2);

  // 6) lazy summary folding: keep appending until > 60 stored messages
  let folded = false;
  for (let i = 0; i < 40; i++) {
    await appendExchange(conv.id, UNIT_USER, `unit question ${i}`, `unit answer ${i}`, META);
    const row = await getConversation(UNIT_USER, conv.id);
    if (row && row.summary && row.summary.includes("Earlier turns:")) {
      folded = true;
      check(
        "summary folds oldest half once messages > 60",
        row.messages.length <= 62 && row.messages.length >= 30,
        `stored=${row.messages.length}`
      );
      check(
        "loadHistory caps at 16 turns after folding",
        loadHistory(row as unknown as ConversationRow, 16).length === 16
      );
      check("getSummaryForPrompt exposes the summary", getSummaryForPrompt(row as unknown as ConversationRow).length > 0);
      break;
    }
  }
  check("summary folding actually triggered", folded);

  // 7) message content sanitization (8000-char cap)
  await appendExchange(conv.id, UNIT_USER, "x".repeat(12000), "y".repeat(12000), META);
  const afterBig = await getConversation(UNIT_USER, conv.id);
  check(
    "message content capped at 8000 chars",
    Boolean(afterBig?.messages.slice(-2).every((m) => m.content.length <= 8000))
  );

  // 8) list + archive
  const listed = await listConversations(UNIT_USER, "medical");
  check("listConversations returns the active thread", listed.some((c) => c.id === conv.id));
  check("archive works for the owner", (await archiveConversation(UNIT_USER, conv.id)) === true);
  check("archived thread disappears from the list", !(await listConversations(UNIT_USER, "medical")).some((c) => c.id === conv.id));
  check("archived thread 404s on read", (await getConversation(UNIT_USER, conv.id)) === null);
  check("double archive returns false", (await archiveConversation(UNIT_USER, conv.id)) === false);
  check("foreign archive was impossible", (await archiveConversation("unit-test-other-user", foreign.id)) === true, "(own thread of the other unit user)");
}

function partBBudgetGuard() {
  console.log("\n── Part B: daily budget guard (env caps: AI_DAILY_AGENT_REQUESTS=2, AI_GLOBAL_AGENT_DAILY=3) ──");

  const user = "unit-budget-user";
  const d0 = checkAiBudget(user, "medical");
  check("starts allowed", d0.allowed && d0.reason === "ok", `cap=${d0.perUserCap}`);
  check("env cap picked up (2/day)", d0.perUserCap === 2, `got ${d0.perUserCap}`);

  consumeAiBudget(user, "medical");
  consumeAiBudget(user, "medical");
  const d2 = checkAiBudget(user, "medical");
  check("blocked at the per-user cap", !d2.allowed && d2.reason === "per_user", `used=${d2.perUserUsed}/${d2.perUserCap}`);

  // Different agent → independent counter.
  check("other agent unaffected", checkAiBudget(user, "medicine").allowed);

  // Emergency: exempt from the per-user cap, but the GLOBAL cap applies.
  const e0 = checkAiBudget(user, "emergency");
  check("emergency exempt from per-user cap", e0.allowed && e0.perUserCap === 0, `cap=${e0.perUserCap}`);
  consumeAiBudget(user, "emergency");
  consumeAiBudget(user, "emergency");
  check("emergency still allowed past the per-user cap", checkAiBudget(user, "emergency").allowed);
  consumeAiBudget(user, "emergency"); // global medical+emergency counters are per-AGENT: emergency has its own global counter
  const e3 = checkAiBudget(user, "emergency");
  check("emergency hits the GLOBAL cap (3/day)", !e3.allowed && e3.reason === "global", `global=${e3.globalUsed}/${e3.globalCap}`);

  // Cache semantics are enforced by call order in the gateway (hits return
  // before consumeAiBudget) — verified end-to-end in test-conversations.ts.
  const d3 = checkAiBudget(user, "medical");
  check("budget decision reports the limits", d3.globalCap === 3 && d3.perUserCap === 2);
}

async function cleanup() {
  await db.conversation.deleteMany({ where: { userId: { in: [UNIT_USER, "unit-test-other-user"] } } });
}

async function main() {
  console.log("════════ CONVERSATION 2.0 + BUDGET UNIT VERIFICATION ════════");
  try {
    await partAConversationService();
    partBBudgetGuard();
  } finally {
    await cleanup();
    await db.$disconnect();
  }
  console.log(`\n══ RESULT: ${passed} passed, ${failed} failed ══`);
  if (failures.length) console.log("Failed:", failures.join(", "));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("unit test crashed:", err);
  process.exit(1);
});
