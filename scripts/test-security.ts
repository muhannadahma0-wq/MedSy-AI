/**
 * MASTER AUDIT security verification suite (P1-62, P1-63, P0-07/08, P0-13,
 * P0-14/15/16, P1-48).
 *
 * Covers, over live HTTP + a real socket.io client:
 *   AUTH MATRIX      — anonymous 401, garbage token 401, expired JWT 401,
 *                      deleted-account 401, disabled 403, tokenVersion bump 401,
 *                      body user-id ignored (server identity wins).
 *   CROSS-USER (BOLA)— foreign report 404, foreign medication 404,
 *                      foreign analytics 403.
 *   SOCKET           — no-token rejected, query-string token REJECTED (P0-14),
 *                      room derived from verified identity: a socket that asks
 *                      to join another user's room must NOT receive that
 *                      user's notifications (P0-15/16).
 *   UPLOAD           — fake PDF (text content, .pdf name/type) rejected by
 *                      magic-byte validation (P1-48).
 *   RATE LIMITS      — login brute force → 429; resend-otp cooldown → 429
 *                      (both via a spoofed X-Forwarded-For so the runner's
 *                      real IP bucket is never polluted).
 *
 * Self-cleaning: every user/row it creates is removed; the demo account's
 * status/tokenVersion are restored to (active, 0) at the end.
 *
 * Run: bun run scripts/test-security.ts
 */
// ADR-06 (migrated-stack runs): point this script's own Prisma client at the
// same database the API under test uses, via an explicit module path + URL.
// Default (no env set) is byte-identical baseline behavior — no assertion touched.
const { PrismaClient } = (await import(
  process.env.TEST_PRISMA_CLIENT ?? "@prisma/client"
)) as typeof import("@prisma/client");
import crypto from "crypto";
import { io } from "socket.io-client";

const db = new PrismaClient();
const BASE = process.env.BASE_URL || "http://localhost:3000";
const EMIT_BRIDGE = "http://127.0.0.1:3004";
const JWT_SECRET = process.env.JWT_SECRET || "medsync-ai-sandbox-secret";

const DEMO_EMAIL = "demo@medsync.ai";
const DEMO_PASSWORD = "demo1234";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}${details ? ` — ${details}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${details ? ` — ${details}` : ""}`);
  }
}

async function api(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Craft an HS256 token exactly like the app's signToken (for testing). */
function craftToken(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

async function main() {
  console.log("════════ MEDSYNC MASTER-AUDIT SECURITY SUITE ════════\n");

  // ---------------------------------------------------------------- setup
  const demoUser = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!demoUser) throw new Error("demo user missing — run seed-demo first");
  const foreign = await db.user.findFirst({
    where: { id: { not: demoUser.id } },
    orderBy: { createdAt: "asc" },
  });
  if (!foreign) throw new Error("need at least one other user for BOLA tests");

  const login = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  check("setup: demo login", login.status === 200, `status ${login.status}`);
  const demoToken = login.body.token as string;

  // ------------------------------------------------- 1. AUTH MATRIX (P1-62)
  console.log("\n── 1. Authentication matrix ──");

  const anon = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("anonymous request → 401", anon.status === 401, `status ${anon.status}`);

  const garbage = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer not.a.jwt" },
    body: JSON.stringify({}),
  });
  check("garbage token → 401", garbage.status === 401, `status ${garbage.status}`);

  const expired = craftToken({
    id: demoUser.id,
    tv: 0,
    iat: Math.floor(Date.now() / 1000) - 90000,
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
  const expiredRes = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${expired}` },
    body: JSON.stringify({}),
  });
  check("expired JWT → 401", expiredRes.status === 401, `status ${expiredRes.status}`);

  const ghost = craftToken({ id: "cmghostuser0000000000000", tv: 0 });
  const ghostRes = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ghost}` },
    body: JSON.stringify({}),
  });
  check(
    "valid signature but deleted/nonexistent account → 401 (P0-07)",
    ghostRes.status === 401,
    `status ${ghostRes.status}`
  );

  // P0-08 — session versioning: bump tokenVersion → old token invalidated.
  await db.user.update({ where: { id: demoUser.id }, data: { tokenVersion: 7 } });
  const bumped = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
    body: JSON.stringify({}),
  });
  check(
    "tokenVersion bump → old token 401 SESSION_INVALIDATED (P0-08)",
    bumped.status === 401 && bumped.body?.code === "SESSION_INVALIDATED",
    `status ${bumped.status} code ${bumped.body?.code}`
  );
  await db.user.update({ where: { id: demoUser.id }, data: { tokenVersion: 0 } });
  const restored = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
    body: JSON.stringify({}),
  });
  check(
    "tokenVersion restored → token valid again",
    restored.status >= 200 && restored.status < 300,
    `status ${restored.status}`
  );

  // P0-07 — disabled account.
  await db.user.update({ where: { id: demoUser.id }, data: { status: "disabled" } });
  const disabled = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
    body: JSON.stringify({}),
  });
  check(
    "disabled account → 403 ACCOUNT_DISABLED (P0-07)",
    disabled.status === 403 && disabled.body?.code === "ACCOUNT_DISABLED",
    `status ${disabled.status} code ${disabled.body?.code}`
  );
  await db.user.update({ where: { id: demoUser.id }, data: { status: "active" } });

  // P0-02 — body identity must be ignored: the route answers with the
  // CALLER's own data even when the body claims to be another user.
  const forged = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
    body: JSON.stringify({ localuser: { id: foreign.id } }),
  });
  const demoMedIds = new Set(
    (await db.medication.findMany({ where: { userId: demoUser.id }, select: { id: true } })).map((m) => m.id)
  );
  const returnedMeds: any[] = forged.body?.medications || forged.body?.todaysMedicine || forged.body?.data || [];
  const medIds = returnedMeds.map((m: any) => m.id || m._id || m.medId).filter(Boolean) as string[];
  check(
    "body user-id of ANOTHER user → ignored, caller's own data returned (P0-02)",
    forged.status >= 200 && forged.status < 300 && medIds.every((id) => demoMedIds.has(id)),
    `status ${forged.status}, ${medIds.length} meds, all owned by caller: ${medIds.every((id) => demoMedIds.has(id))}`
  );

  // ------------------------------------------- 2. CROSS-USER / BOLA (P1-63)
  console.log("\n── 2. Cross-user isolation (BOLA/IDOR) ──");

  const foreignReport = await db.report.findFirst({
    where: { userId: { not: demoUser.id } },
  });
  if (foreignReport) {
    const steal = await api(`/api/report/${foreignReport.id}/readability`, {
      headers: { Authorization: `Bearer ${demoToken}` },
    });
    check(
      "foreign report readability → 404 (P0-03/04)",
      steal.status === 404,
      `status ${steal.status}`
    );
    const chat = await api("/api/agents/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
      body: JSON.stringify({ reportId: foreignReport.id, question: "summarize" }),
    });
    check(
      "chat with foreign report → 404 (P0-04)",
      chat.status === 404,
      `status ${chat.status}`
    );
  } else {
    check("foreign report test (skipped — no other-user reports)", true);
  }

  const foreignMed = await db.medication.findFirst({
    where: { userId: { not: demoUser.id } },
  });
  if (foreignMed) {
    const del = await api("/api/medicine/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
      body: JSON.stringify({ medId: foreignMed.id }),
    });
    check(
      "delete foreign medication → 404 (no deletion)",
      del.status === 404,
      `status ${del.status}`
    );
    const stillThere = await db.medication.findUnique({ where: { id: foreignMed.id } });
    check("foreign medication row still intact", stillThere !== null);
  } else {
    check("foreign medication test (skipped — none)", true);
  }

  const foreignAnalytics = await api(`/api/analytics/${foreign.id}`, {
    headers: { Authorization: `Bearer ${demoToken}` },
  });
  check(
    "another user's analytics → 403",
    foreignAnalytics.status === 403,
    `status ${foreignAnalytics.status}`
  );

  // --------------------------------------------- 3. SOCKET SECURITY (P0-14/15/16)
  console.log("\n── 3. Socket.IO security ──");

  const socketUrl = "http://localhost:3003";
  const socketPath = "/";

  // 3a. No token → rejected.
  await new Promise<void>((resolve) => {
    const s = io(socketUrl, { path: socketPath, transports: ["websocket"], timeout: 4000, reconnection: false });
    s.on("connect_error", (err: Error) => {
      check("socket without token → rejected", /token/i.test(err.message), err.message);
      s.close();
      resolve();
    });
    s.on("connect", () => {
      check("socket without token → rejected", false, "connected without token!");
      s.close();
      resolve();
    });
  });

  // 3b. Token in the QUERY STRING only → REJECTED (P0-14).
  await new Promise<void>((resolve) => {
    const s = io(`${socketUrl}/?token=${encodeURIComponent(demoToken)}`, {
      path: socketPath,
      transports: ["websocket"],
      timeout: 4000,
      reconnection: false,
      auth: {},
    });
    s.on("connect_error", (err: Error) => {
      check(
        "query-string token → REJECTED (P0-14)",
        /token/i.test(err.message),
        err.message
      );
      s.close();
      resolve();
    });
    s.on("connect", () => {
      check("query-string token → REJECTED (P0-14)", false, "connected via query token!");
      s.close();
      resolve();
    });
  });

  // 3c. Room isolation: attacker socket (valid token for user B) asks to join
  //     user A's room — must NOT receive A's notification (P0-15/16).
  const attackerToken = craftToken({ id: "cmattacker00000000000000", tv: 0 });
  await new Promise<void>((resolve) => {
    const victim = io(socketUrl, {
      path: socketPath,
      transports: ["websocket"],
      timeout: 5000,
      reconnection: false,
      auth: { token: demoToken },
    });
    const attacker = io(socketUrl, {
      path: socketPath,
      transports: ["websocket"],
      timeout: 5000,
      reconnection: false,
      auth: { token: attackerToken },
    });

    let victimGot = false;
    let attackerGot = false;
    victim.on("connect", () => {
      victim.emit("join-user", demoUser.id); // normal join
    });
    attacker.on("connect", () => {
      // ATTACK: ask to join the victim's room.
      attacker.emit("join-user", demoUser.id);
      // Give the server a moment to (wrongly) process it, then fire
      // notifications into the victim's room via the loopback bridge.
      // MR-19 (2026-10-01): the bridge now requires an HMAC signature over
      // the raw body (shared JWT_SECRET). First an UNSIGNED call (must be
      // rejected), then the properly signed one (must be delivered).
      setTimeout(async () => {
        const body = JSON.stringify({
          userId: demoUser.id,
          notification: { id: "sec-test", title: "security probe" },
        });
        const unsigned = await fetch(`${EMIT_BRIDGE}/emit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }).catch(() => null);
        check(
          "emit bridge rejects UNSIGNED call (MR-19)",
          unsigned !== null && unsigned.status === 401,
          unsigned ? `status=${unsigned.status}` : "network error"
        );
        const signature = crypto.createHmac("sha256", process.env.JWT_SECRET || "medsync-ai-sandbox-secret")
          .update(body)
          .digest("hex");
        await fetch(`${EMIT_BRIDGE}/emit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-emit-signature": signature },
          body,
        }).catch(() => {});
      }, 600);
    });
    victim.on("notification", () => {
      victimGot = true;
    });
    attacker.on("notification", () => {
      attackerGot = true;
    });

    setTimeout(() => {
      check(
        "room isolation: victim receives own notification",
        victimGot,
        victimGot ? "delivered" : "not delivered"
      );
      check(
        "room isolation: attacker does NOT receive victim's notification (P0-15)",
        !attackerGot,
        attackerGot ? "LEAK — attacker received it!" : "no leak"
      );
      victim.close();
      attacker.close();
      resolve();
    }, 3500);
  });

  // ------------------------------------------------ 4. UPLOAD (P1-48)
  console.log("\n── 4. Upload hardening ──");
  const fakePdf = new File(
    [Buffer.from("this is definitely not a pdf, just text with a pdf costume")],
    "evil.pdf",
    { type: "application/pdf" }
  );
  const uploadForm = new FormData();
  uploadForm.append("file", fakePdf);
  const fakeUpload = await api("/api/report/analyze", {
    method: "POST",
    headers: { Authorization: `Bearer ${demoToken}` },
    body: uploadForm,
  });
  check(
    "fake PDF (text content) → 415 magic-byte rejection (P1-48)",
    fakeUpload.status === 415,
    `status ${fakeUpload.status}`
  );

  // --------------------------------------------- 5. RATE LIMITS (P0-13)
  console.log("\n── 5. Rate limiting (spoofed XFF, isolated buckets) ──");
  // Unique spoofed IP per RUN so repeated suite executions never inherit a
  // half-full bucket from the previous run.
  const SPOOF = { "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 250) + 1}` };

  let got429 = false;
  let attempts = 0;
  const bruteEmail = `brute-force-${Date.now()}@invalid.example`;
  for (let i = 0; i < 15; i++) {
    const r = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...SPOOF },
      body: JSON.stringify({ email: bruteEmail, password: "wrong" }),
    });
    attempts++;
    if (r.status === 429) {
      got429 = true;
      check(
        "login brute force → 429 RATE_LIMITED with Retry-After",
        r.body?.code === "RATE_LIMITED" && r.headers.get("retry-after") !== null,
        `after ${attempts} attempts, Retry-After=${r.headers.get("retry-after")}`
      );
      break;
    }
  }
  if (!got429) check("login brute force → 429", false, `no 429 after ${attempts} attempts`);

  // resend-otp cooldown on a fresh (cleaned-up) unverified account.
  const cooldownEmail = `cooldown-test-${Date.now()}@invalid.example`;
  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...SPOOF },
    body: JSON.stringify({ name: "Cooldown Probe", email: cooldownEmail, password: "probepassword123" }),
  });
  const r1 = await api("/api/auth/resend-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...SPOOF },
    body: JSON.stringify({ email: cooldownEmail }),
  });
  const r2 = await api("/api/auth/resend-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...SPOOF },
    body: JSON.stringify({ email: cooldownEmail }),
  });
  check(
    "resend-otp cooldown → immediate 2nd request 429 (P0-13)",
    r1.status === 200 && r2.status === 429,
    `first ${r1.status}, second ${r2.status}`
  );
  await db.user.deleteMany({ where: { email: cooldownEmail } });

  // --------------------------------------- 6. LOGOUT INVALIDATES SESSION (P0-10/P1-62)
  console.log("\n── 6. Logout session invalidation ──");
  const logoutRes = await api("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
    body: JSON.stringify({ allDevices: true }),
  });
  const setCookie = logoutRes.headers.get("set-cookie") || "";
  check(
    "logout clears the HttpOnly cookie (Set-Cookie Max-Age=0)",
    logoutRes.status === 200 && /Max-Age=0/.test(setCookie),
    `status ${logoutRes.status}`
  );
  const afterLogout = await api("/api/medicine/today", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
    body: JSON.stringify({}),
  });
  check(
    "allDevices logout bumps tokenVersion → old token 401 (P0-08)",
    afterLogout.status === 401,
    `status ${afterLogout.status}`
  );
  // Restore for teardown correctness.
  await db.user.update({ where: { id: demoUser.id }, data: { tokenVersion: 0 } });

  // ---------------------------------------------------------------- teardown
  await db.user.update({
    where: { id: demoUser.id },
    data: { status: "active", tokenVersion: 0 },
  });
  await db.user.deleteMany({ where: { email: { contains: "@invalid.example" } } });

  console.log("\n════════ RESULT ════════");
  console.log(`PASS ${passed} / FAIL ${failed}`);
  if (failures.length > 0) {
    console.log("Failed checks:", failures.join(" | "));
    process.exit(1);
  }
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("SUITE CRASHED:", err);
  try {
    await db.user.update({
      where: { email: DEMO_EMAIL },
      data: { status: "active", tokenVersion: 0 },
    });
    await db.user.deleteMany({ where: { email: { contains: "@invalid.example" } } });
    await db.$disconnect();
  } catch {}
  process.exit(1);
});
