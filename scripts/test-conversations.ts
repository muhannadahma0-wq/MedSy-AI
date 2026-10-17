/**
 * Conversation 2.0 END-TO-END verification (v5 items: conversation threads,
 * AI response cache, budget) against the running dev server (:3000).
 *
 * Covers:
 *   (1) gateway POST creates a thread and returns conversationId;
 *   (2) GET /api/agents/conversations?agent= lists it;
 *   (3) follow-up with the SAME conversationId threads history
 *       (historyUsed, messages grew by 2, earlier exchange present);
 *   (4) BOLA: a second user cannot read/append/delete the first user's
 *       thread (404 / new thread / 404);
 *   (5) DELETE soft-archives (list no longer shows it, GET 404s);
 *   (6) cache: the same static knowledge question twice → cached:true on
 *       the second answer; a personal-health question is NEVER cached;
 *   (7) emergency safety path also threads a conversation;
 *   plus route validation (400/401) and the logId/conversationId metadata.
 *
 * The daily-budget guard is verified by the companion unit script
 * (scripts/test-conversations-unit.ts — tiny env caps in a subprocess).
 *
 * Self-cleaning: test conversations are archived via the API and then
 * hard-deleted; the second (signup) user is removed entirely.
 *
 * Run: bun run scripts/test-conversations.ts
 */
// ADR-06 (migrated-stack runs): point this script's own Prisma client at the
// same database the API under test uses, via an explicit module path + URL.
// Default (no env set) is byte-identical baseline behavior — no assertion touched.
const { PrismaClient } = (await import(
  process.env.TEST_PRISMA_CLIENT ?? "@prisma/client"
)) as typeof import("@prisma/client");

const db = new PrismaClient();
const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEMO_EMAIL = "demo@medsync.ai";
const DEMO_PASSWORD = "demo1234";

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

async function api(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function authPost(token: string, path: string, payload: unknown) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

function authGet(token: string, path: string) {
  return api(path, { headers: { Authorization: `Bearer ${token}` } });
}

function authDelete(token: string, path: string) {
  return api(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

async function login(): Promise<string> {
  const { body } = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  return body.token;
}

/** Create a throwaway user through the real signup+OTP flow (sandbox OTP echo). */
async function signupUser(email: string): Promise<{ token: string; userId: string }> {
  const nonce = Date.now();
  const signup = await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Conv Test ${nonce}`, email, password: "convtest12345" }),
  });
  const otp = signup.body?.demoOtp;
  if (!otp) throw new Error(`signup did not return demoOtp: ${JSON.stringify(signup.body).slice(0, 200)}`);
  const verify = await api("/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  const token = verify.body?.token;
  if (!token) throw new Error(`verify-otp did not return a token: ${JSON.stringify(verify.body).slice(0, 200)}`);
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("signup user row missing");
  return { token, userId: user.id };
}

async function main() {
  console.log("════════ CONVERSATION 2.0 E2E VERIFICATION ════════\n");

  const token = await login();
  if (!token) {
    console.error("LOGIN FAILED — aborting");
    process.exit(1);
  }
  const demo = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!demo) throw new Error("demo user missing");

  const createdConversationIds: string[] = []; // demo-user threads to clean

  // ---------------------------------------------------------------- (1) create
  console.log("STEP 1: gateway POST creates a conversation thread");
  const runNonce = Date.now().toString(36);
  // Unique per-run question: a repeat run must not hit the knowledge cache
  // (a cached answer reports historyUsed=0 BY DESIGN — it skips the provider).
  const q1 = `What is hypertension? (run ${runNonce})`;
  const first = await authPost(token, "/api/agents", {
    input: q1,
    preferredAgent: "medical",
    language: "en",
  });
  const c1: string | undefined = first.body?.conversationId;
  check("200 + success", first.status === 200 && first.body?.success === true, `status=${first.status}`);
  check("conversationId returned", typeof c1 === "string" && c1.length > 0, c1 || "");
  check("logId returned (AiLog audit row)", typeof first.body?.logId === "string" && first.body.logId.length > 0);
  check("cached:false on a fresh question", first.body?.cached === false);
  check("historyUsed:0 on a new thread", first.body?.historyUsed === 0);
  check("routedTo=medical", first.body?.routedTo === "medical");
  if (c1) createdConversationIds.push(c1);

  // ---------------------------------------------------------------- (2) list
  console.log("STEP 2: GET /api/agents/conversations?agent=medical lists it");
  const list1 = await authGet(token, "/api/agents/conversations?agent=medical");
  check("200 + conversations array", list1.status === 200 && Array.isArray(list1.body?.conversations));
  const listed = (list1.body?.conversations || []).some((c: any) => c.id === c1);
  check("the new thread is listed", listed);
  const listItem = (list1.body?.conversations || []).find((c: any) => c.id === c1);
  check(
    "list item shape (title/messageCount/language/updatedAt)",
    listItem && typeof listItem.title === "string" && typeof listItem.messageCount === "number" && typeof listItem.language === "string" && Boolean(listItem.updatedAt)
  );

  // ---------------------------------------------------------------- (3) follow-up
  console.log("STEP 3: follow-up with the SAME conversationId threads history");
  const before = await authGet(token, `/api/agents/conversations?id=${c1}`);
  check("GET ?id= returns the thread", before.status === 200 && before.body?.conversation?.id === c1);
  check("thread has 2 messages after the first exchange", before.body?.conversation?.messages?.length === 2, `got ${before.body?.conversation?.messages?.length}`);
  check("title set from the first user message", before.body?.conversation?.title === q1);

  const second = await authPost(token, "/api/agents", {
    input: `What are the common ways to manage it? (run ${runNonce})`,
    preferredAgent: "medical",
    language: "en",
    conversationId: c1,
  });
  check("follow-up 200 + same conversationId", second.status === 200 && second.body?.conversationId === c1, `got ${second.body?.conversationId}`);
  check("history threaded (historyUsed=2)", second.body?.historyUsed === 2, `got ${second.body?.historyUsed}`);

  const after = await authGet(token, `/api/agents/conversations?id=${c1}`);
  const msgs = after.body?.conversation?.messages || [];
  check("messages grew by 2 (total 4)", msgs.length === 4, `got ${msgs.length}`);
  check(
    "earlier exchange still present",
    msgs.some((m: any) => m.role === "user" && String(m.content).includes("hypertension")) &&
      msgs.some((m: any) => m.role === "assistant")
  );
  check("messageCount follows the stored array", after.body?.conversation?.messageCount === 4);

  // ---------------------------------------------------------------- (4) BOLA
  console.log("STEP 4: BOLA — a second user cannot touch the first user's thread");
  const secondEmail = `convtest-${runNonce}@medsync-test.local`;
  const secondUser = await signupUser(secondEmail);

  const foreignRead = await authGet(secondUser.token, `/api/agents/conversations?id=${c1}`);
  check("foreign GET ?id= → 404", foreignRead.status === 404, `got ${foreignRead.status}`);

  const foreignAppend = await authPost(secondUser.token, "/api/agents", {
    input: "What is the common cold?",
    preferredAgent: "medical",
    language: "en",
    conversationId: c1, // tries to continue the first user's thread
  });
  check(
    "foreign conversationId is IGNORED (a new thread is created, nothing appended)",
    foreignAppend.status === 200 && typeof foreignAppend.body?.conversationId === "string" && foreignAppend.body.conversationId !== c1
  );
  const still4 = await authGet(token, `/api/agents/conversations?id=${c1}`);
  check("victim thread unchanged (still 4 messages)", still4.body?.conversation?.messages?.length === 4);

  const foreignDelete = await authDelete(secondUser.token, `/api/agents/conversations?id=${c1}`);
  check("foreign DELETE → 404", foreignDelete.status === 404, `got ${foreignDelete.status}`);

  const foreignList = await authGet(secondUser.token, "/api/agents/conversations?agent=medical");
  check("foreign list does not contain the victim thread", !(foreignList.body?.conversations || []).some((c: any) => c.id === c1));

  // ---------------------------------------------------------------- (5) archive
  console.log("STEP 5: DELETE soft-archives the caller's thread");
  const del = await authDelete(token, `/api/agents/conversations?id=${c1}`);
  check("DELETE → 200 {success:true}", del.status === 200 && del.body?.success === true, `got ${del.status}`);
  const list2 = await authGet(token, "/api/agents/conversations?agent=medical");
  check("archived thread no longer listed", !(list2.body?.conversations || []).some((c: any) => c.id === c1));
  const gone = await authGet(token, `/api/agents/conversations?id=${c1}`);
  check("archived thread GET → 404", gone.status === 404);

  // ---------------------------------------------------------------- (6) cache
  console.log("STEP 6: AI response cache (static knowledge cached; personal health never)");
  const staticQuestion = `What is hypertension and why does it matter? (test ${runNonce})`;
  const c1a = await authPost(token, "/api/agents", { input: staticQuestion, preferredAgent: "medical", language: "en" });
  check("first static ask: cached=false", c1a.status === 200 && c1a.body?.cached === false, `provider=${c1a.body?.provider}`);
  if (c1a.body?.conversationId) createdConversationIds.push(c1a.body.conversationId);
  const c1b = await authPost(token, "/api/agents", { input: staticQuestion, preferredAgent: "medical", language: "en" });
  check("second static ask: cached=true", c1b.status === 200 && c1b.body?.cached === true, `provider=${c1b.body?.provider}`);
  check("cache hit reports provider=cache", c1b.body?.provider === "cache");
  check("cache hit returns the SAME answer text", c1b.body?.output === c1a.body?.output);
  check("cache hit still returns a conversationId + logId", typeof c1b.body?.conversationId === "string" && typeof c1b.body?.logId === "string");
  check("cache hit does not inject history (historyUsed=0)", c1b.body?.historyUsed === 0);
  if (c1b.body?.conversationId && !createdConversationIds.includes(c1b.body.conversationId)) {
    createdConversationIds.push(c1b.body.conversationId);
  }

  const personalQ = `How can I improve my sleep quality? (test ${runNonce})`;
  const p1 = await authPost(token, "/api/agents", { input: personalQ, language: "en" });
  check("personal-health question routed to personal-health", p1.body?.routedTo === "personal-health", `got ${p1.body?.routedTo}`);
  check("personal-health answer NOT cached (1st)", p1.body?.cached === false);
  const p2 = await authPost(token, "/api/agents", { input: personalQ, language: "en" });
  check("personal-health answer NOT cached (2nd)", p2.body?.cached === false && p2.body?.provider !== "cache", `provider=${p2.body?.provider}`);
  if (p2.body?.conversationId) createdConversationIds.push(p2.body.conversationId);

  // ---------------------------------------------------------------- (7) emergency
  console.log("STEP 7: emergency safety path also threads a conversation");
  const em = await authPost(token, "/api/agents", {
    input: "I took too many pills and I have difficulty breathing",
    language: "en",
  });
  check("emergency routed", em.body?.routedTo === "emergency" && em.body?.severity === "emergency");
  check("emergency response carries a conversationId", typeof em.body?.conversationId === "string" && em.body.conversationId.length > 0);
  check("emergency answer is never cached", em.body?.cached === false);
  if (em.body?.conversationId) createdConversationIds.push(em.body.conversationId);
  const emThread = await authGet(token, `/api/agents/conversations?id=${em.body?.conversationId}`);
  check(
    "emergency thread stored the exchange (agent=emergency row)",
    emThread.status === 200 && emThread.body?.conversation?.agent === "emergency" && emThread.body?.conversation?.messages?.length === 2
  );

  // ---------------------------------------------------------------- validation
  console.log("STEP 8: route validation");
  const badAgent = await authGet(token, "/api/agents/conversations?agent=bogus");
  check("?agent=bogus → 400", badAgent.status === 400);
  const noParams = await authGet(token, "/api/agents/conversations");
  check("no params → 400", noParams.status === 400);
  const noAuth = await api("/api/agents/conversations?agent=medical");
  check("unauthenticated → 401", noAuth.status === 401);
  const noAuthDelete = await api("/api/agents/conversations?id=x");
  check("unauthenticated DELETE → 401", noAuthDelete.status === 401);

  // ---------------------------------------------------------------- cleanup
  console.log("\n── cleanup ──");
  for (const id of createdConversationIds) {
    await authDelete(token, `/api/agents/conversations?id=${id}`).catch(() => {});
  }
  // Hard-delete the test rows (demo threads + everything the second user made).
  const removed = await db.conversation.deleteMany({
    where: {
      userId: { in: [demo.id, secondUser.userId] },
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
  });
  const removedUsers = await db.user.deleteMany({ where: { id: secondUser.userId } });
  check("test conversations hard-deleted", removed.count >= createdConversationIds.length, `${removed.count} rows`);
  check("second (signup) user removed", removedUsers.count === 1);

  await db.$disconnect();
  console.log(`\n══ RESULT: ${passed} passed, ${failed} failed ══`);
  if (failures.length) console.log("Failed:", failures.join(", "));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("e2e test crashed:", err);
  await db.$disconnect();
  process.exit(1);
});
