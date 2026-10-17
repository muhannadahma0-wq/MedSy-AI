/**
 * Research / feedback / consent verification suite (v5 review items 38/H,
 * 42/I, 43, 44 — Task 2-b).
 *
 * Covers, over live HTTP against :3000:
 *   FEEDBACK   — POST /api/agents/feedback: valid insert; (userId, aiLogId)
 *                upsert updates the rating instead of duplicating; invalid
 *                rating / agent / aiLogId / over-long comment → 400 with the
 *                VALIDATION_ERROR contract; anonymous → 401.
 *   CONSENT    — /api/study/consent: GET null → POST grant (version +
 *                grantedAt, revokedAt null, NO auto study-arm) → DELETE
 *                revoke (grantedAt kept) → idempotent re-DELETE → re-grant.
 *   EXPORT     — /api/study/export: ?all=1 contains the CONSENTED
 *                participant's pseudonymized rows and EXCLUDES the
 *                non-consented user's; a non-consented caller's personal
 *                export is empty and does NOT auto-assign them an arm; the
 *                consent provenance metadata (version + grantedAt /
 *                active-consent-only filter) is present; the CSV header
 *                carries the consent columns.
 *   OVERVIEW   — GET /api/research/overview: full shape (participants /
 *                doses / risk / dataQuality / ai), dataQuality fields all
 *                present, and NO user id (or email) anywhere in the JSON —
 *                checked recursively per value AND as a raw substring of the
 *                serialized payload.
 *   MONITORING — GET /api/ai-monitoring still answers with its original
 *                fields PLUS the new `feedback` section (windowDays 30,
 *                per-agent helpful/unhelpful/unsafe).
 *
 * Auth pattern: users are created directly in the DB (verified + active,
 * tokenVersion 0) and tokens are crafted with JWT_SECRET exactly like the
 * app's signToken (same technique as scripts/test-security.ts).
 *
 * Self-cleaning: every user/medication/dose/consent/feedback/assignment row
 * this suite creates is removed, including the smoke-test feedback rows for
 * the demo account.
 *
 * Run: bun run scripts/test-research.ts
 */
// ADR-06 (migrated-stack runs): point this script's own Prisma client at the
// same database the API under test uses, via an explicit module path + URL.
// Default (no env set) is byte-identical baseline behavior — no assertion touched.
const { PrismaClient } = (await import(
  process.env.TEST_PRISMA_CLIENT ?? "@prisma/client"
)) as typeof import("@prisma/client");
import crypto from "crypto";

const db = new PrismaClient();
const BASE = process.env.BASE_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "medsync-ai-sandbox-secret";
const STUDY_SALT = process.env.STUDY_SALT || "medsync-study-salt-v1";
const CONSENT_VERSION = process.env.STUDY_CONSENT_VERSION || "1.0.0";

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
): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: any = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Craft an HS256 token exactly like the app's signToken (see jwt.ts). */
function craftToken(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

function pseudonymize(userId: string): string {
  return crypto.createHash("sha256").update(userId + STUDY_SALT).digest("hex").slice(0, 16);
}

/** Recursively assert that no string value in the payload is a known id/email. */
function assertNoIdentifiers(node: unknown, banned: Set<string>, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof node === "string") {
    if (banned.has(node)) hits.push(`${path} = ${node}`);
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => hits.push(...assertNoIdentifiers(item, banned, `${path}[${i}]`)));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (banned.has(key)) hits.push(`${path}.${key} (key)`);
      hits.push(...assertNoIdentifiers(value, banned, `${path}.${key}`));
    }
  }
  return hits;
}

async function main() {
  console.log("════════ MEDSYNC RESEARCH / FEEDBACK / CONSENT SUITE ════════\n");

  // ---------------------------------------------------------------- setup
  const EMAIL_A = "research-a.test@medsync-test.local";
  const EMAIL_B = "research-b.test@medsync-test.local";

  // Clean any leftovers from a previous (failed) run first.
  for (const email of [EMAIL_A, EMAIL_B]) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      await db.aiFeedback.deleteMany({ where: { userId: existing.id } });
      await db.studyConsent.deleteMany({ where: { userId: existing.id } });
      await db.studyAssignment.deleteMany({ where: { userId: existing.id } });
      await db.riskPrediction.deleteMany({ where: { userId: existing.id } });
      await db.smartReminder.deleteMany({ where: { userId: existing.id } });
      await db.doseEvent.deleteMany({ where: { userId: existing.id } });
      await db.medication.deleteMany({ where: { userId: existing.id } });
      await db.user.delete({ where: { id: existing.id } });
    }
  }
  // Remove smoke-test feedback rows (manual curl probes on the demo account).
  const demo = await db.user.findUnique({ where: { email: "demo@medsync.ai" } });
  if (demo) {
    await db.aiFeedback.deleteMany({ where: { userId: demo.id, aiLogId: "clogtest1234567890" } });
  }

  const userA = await db.user.create({
    data: {
      email: EMAIL_A,
      name: "Research Test A",
      password: "scrypt:00:00", // never logs in via password — tokens are crafted
      isVerified: true,
      status: "active",
      tokenVersion: 0,
      timeZone: "UTC",
    },
  });
  const userB = await db.user.create({
    data: {
      email: EMAIL_B,
      name: "Research Test B",
      password: "scrypt:00:00",
      isVerified: true,
      status: "active",
      tokenVersion: 0,
      timeZone: "UTC",
    },
  });
  const tokenA = craftToken({ id: userA.id, tv: 0 });
  const tokenB = craftToken({ id: userB.id, tv: 0 });
  const authA = { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" };
  const authB = { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" };

  // Preflight: prove the SERVER sees users created by this script's DB
  // connection. A 401 here means the dev server is holding a DELETED db
  // inode (the SQLite file was replaced underneath it — e.g. a parallel
  // `prisma db push` or a backup restore while the server kept running).
  // Every subsequent check would fail confusingly, so abort with a hint.
  {
    const probe = await api("/api/study/consent", { headers: authA });
    if (probe.status === 401) {
      console.error(
        "\n⛔ PREFLIGHT FAILED: the dev server cannot see users created moments ago.\n" +
          "   The db/custom.db file was most likely REPLACED (inode swap) while the\n" +
          "   server was running, so the server serves a stale deleted inode.\n" +
          "   Fix: restart the dev server (bash scripts/launch-services.sh after\n" +
          "   stopping the old process), then re-run this suite.\n"
      );
      throw new Error("dev server holds a stale database inode — restart required");
    }
  }

  const now = new Date();
  const medA = await db.medication.create({
    data: {
      userId: userA.id,
      pillName: "TestMedA",
      startDate: now,
      dosageDays: JSON.stringify([]),
      dosageTimes: JSON.stringify([]),
    },
  });
  const medB = await db.medication.create({
    data: {
      userId: userB.id,
      pillName: "TestMedB",
      startDate: now,
      dosageDays: JSON.stringify([]),
      dosageTimes: JSON.stringify([]),
    },
  });
  await db.doseEvent.create({
    data: {
      userId: userA.id,
      medicationId: medA.id,
      scheduledAt: new Date(now.getTime() - 3600_000),
      slotTime: "08:00",
      status: "taken",
    },
  });
  await db.doseEvent.create({
    data: {
      userId: userB.id,
      medicationId: medB.id,
      scheduledAt: new Date(now.getTime() - 3600_000),
      slotTime: "09:00",
      status: "missed",
    },
  });

  // ─────────────────────────────────────────────────────── 1. FEEDBACK API
  console.log("── 1. POST /api/agents/feedback ──");

  const AI_LOG_ID = "cfeedtest0000000000000a";

  const anon = await api("/api/agents/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "medical", rating: "helpful" }),
  });
  check("anonymous feedback → 401", anon.status === 401, `status ${anon.status}`);

  const fb1 = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "medical", rating: "helpful", aiLogId: AI_LOG_ID, comment: "  clear answer  " }),
  });
  check(
    "valid feedback → 201 {success, feedback:{id, rating}}",
    fb1.status === 201 && fb1.body?.success === true && typeof fb1.body?.feedback?.id === "string" && fb1.body?.feedback?.rating === "helpful",
    `status ${fb1.status} body ${JSON.stringify(fb1.body)}`
  );

  const fb2 = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "medical", rating: "unhelpful", aiLogId: AI_LOG_ID, comment: "not precise" }),
  });
  check(
    "same (userId, aiLogId) → UPDATE not duplicate (200, updated:true)",
    fb2.status === 200 && fb2.body?.updated === true && fb2.body?.feedback?.rating === "unhelpful",
    `status ${fb2.status} body ${JSON.stringify(fb2.body)}`
  );
  check(
    "upsert kept the same feedback row id",
    fb1.body?.feedback?.id && fb2.body?.feedback?.id === fb1.body.feedback.id,
    `${fb1.body?.feedback?.id} vs ${fb2.body?.feedback?.id}`
  );

  const rowsForAnswer = await db.aiFeedback.findMany({ where: { userId: userA.id, aiLogId: AI_LOG_ID } });
  check(
    "DB has exactly ONE row for (user, aiLogId) with the updated rating",
    rowsForAnswer.length === 1 && rowsForAnswer[0].rating === "unhelpful" && rowsForAnswer[0].comment === "not precise",
    `${rowsForAnswer.length} row(s), rating ${rowsForAnswer[0]?.rating}`
  );

  const fbNoLog = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "router", rating: "unsafe", comment: "scary" }),
  });
  check(
    "feedback without aiLogId → plain insert (201, updated:false)",
    fbNoLog.status === 201 && fbNoLog.body?.updated === false,
    `status ${fbNoLog.status}`
  );

  const badRating = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "medical", rating: "great" }),
  });
  check(
    "invalid rating → 400 VALIDATION_ERROR",
    badRating.status === 400 && badRating.body?.error?.code === "VALIDATION_ERROR",
    `status ${badRating.status} ${JSON.stringify(badRating.body)}`
  );

  const badAgent = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "vision", rating: "helpful" }),
  });
  check("invalid agent → 400", badAgent.status === 400, `status ${badAgent.status}`);

  const badLogId = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "medical", rating: "helpful", aiLogId: "not a cuid!!" }),
  });
  check("invalid aiLogId shape → 400", badLogId.status === 400, `status ${badLogId.status}`);

  const longComment = await api("/api/agents/feedback", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ agent: "medical", rating: "helpful", comment: "x".repeat(501) }),
  });
  check("comment > 500 chars → 400", longComment.status === 400, `status ${longComment.status}`);

  // ─────────────────────────────────────────────────────── 2. CONSENT API
  console.log("\n── 2. /api/study/consent lifecycle ──");

  const c0 = await api("/api/study/consent", { headers: authA });
  check(
    "GET before any consent → {success:true, consent:null}",
    c0.status === 200 && c0.body?.success === true && c0.body?.consent === null,
    `status ${c0.status} body ${JSON.stringify(c0.body)}`
  );

  const badGrant = await api("/api/study/consent", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ accept: false }),
  });
  check("POST {accept:false} → 400", badGrant.status === 400, `status ${badGrant.status}`);

  const g1 = await api("/api/study/consent", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ accept: true }),
  });
  check(
    "POST grant → consent {version=STUDY_CONSENT_VERSION, grantedAt, revokedAt:null}",
    g1.status === 201 &&
      g1.body?.consent?.version === CONSENT_VERSION &&
      typeof g1.body?.consent?.grantedAt === "string" &&
      g1.body?.consent?.revokedAt === null,
    `status ${g1.status} body ${JSON.stringify(g1.body)}`
  );
  const grantedAt1 = g1.body?.consent?.grantedAt as string;

  const c1 = await api("/api/study/consent", { headers: authA });
  check(
    "GET after grant shows version + grantedAt",
    c1.status === 200 && c1.body?.consent?.version === CONSENT_VERSION && c1.body?.consent?.grantedAt === grantedAt1 && c1.body?.consent?.revokedAt === null,
    `body ${JSON.stringify(c1.body)}`
  );

  const armAfterGrant = await db.studyAssignment.findUnique({ where: { userId: userA.id } });
  check(
    "granting consent does NOT auto-assign a study arm",
    armAfterGrant === null,
    `assignment: ${JSON.stringify(armAfterGrant)}`
  );

  const r1 = await api("/api/study/consent", { method: "DELETE", headers: authA });
  check(
    "DELETE revoke → revokedAt set, grantedAt kept for audit",
    r1.status === 200 &&
      typeof r1.body?.consent?.revokedAt === "string" &&
      r1.body?.consent?.grantedAt === grantedAt1,
    `body ${JSON.stringify(r1.body)}`
  );
  const revokedAt = r1.body?.consent?.revokedAt as string;

  const c2 = await api("/api/study/consent", { headers: authA });
  check(
    "GET after revoke shows revokedAt",
    c2.status === 200 && c2.body?.consent?.revokedAt === revokedAt,
    `body ${JSON.stringify(c2.body)}`
  );

  const r2 = await api("/api/study/consent", { method: "DELETE", headers: authA });
  check(
    "DELETE again → idempotent success, same revokedAt",
    r2.status === 200 && r2.body?.consent?.revokedAt === revokedAt,
    `body ${JSON.stringify(r2.body)}`
  );

  const g2 = await api("/api/study/consent", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({ accept: true }),
  });
  check(
    "re-grant after revoke → active again (revokedAt:null, grantedAt refreshed)",
    g2.status === 201 && g2.body?.consent?.revokedAt === null && g2.body?.consent?.grantedAt >= grantedAt1,
    `body ${JSON.stringify(g2.body)}`
  );

  // ─────────────────────────────────────────────── 3. EXPORT CONSENT FILTER
  console.log("\n── 3. /api/study/export consent gate ──");
  // State here: A consented (active), B never consented. Both have 1 dose.
  // Give BOTH users a study arm (as the operator endpoint / first
  // getStudyArm lookup would) so the ?all=1 assertions prove the CONSENT
  // filter specifically — B has an arm and dose data, and must still be
  // excluded because B never consented.
  await db.studyAssignment.create({ data: { userId: userA.id, arm: "smart", reason: "operator" } });
  await db.studyAssignment.create({ data: { userId: userB.id, arm: "control", reason: "operator" } });

  const pseudoA = pseudonymize(userA.id);
  const pseudoB = pseudonymize(userB.id);

  const expAll = await api("/api/study/export?all=1&format=json", { headers: authA });
  const allRows = expAll.body?.rows ?? [];
  const participantsInExport = new Set(allRows.map((r: any) => r.participant));
  check(
    "?all=1 export succeeded",
    expAll.status === 200 && expAll.body?.success === true,
    `status ${expAll.status}`
  );
  check(
    "consented participant (A) IS included",
    participantsInExport.has(pseudoA),
    `participants: ${[...participantsInExport].slice(0, 5).join(", ")}… (${allRows.length} rows)`
  );
  check(
    "non-consented participant (B) is EXCLUDED",
    !participantsInExport.has(pseudoB),
    `pseudoB ${pseudoB} absent: ${!participantsInExport.has(pseudoB)}`
  );
  check(
    "?all=1 consent metadata: filter + versions + participant count",
    expAll.body?.consent?.filter === "active-consent-only" &&
      Array.isArray(expAll.body?.consent?.versions) &&
      expAll.body.consent.versions.includes(CONSENT_VERSION) &&
      expAll.body.consent.participantsWithActiveConsent >= 1,
    `consent: ${JSON.stringify(expAll.body?.consent)}`
  );
  check(
    "every exported row carries consent provenance columns",
    allRows.length > 0 && allRows.every((r: any) => r.consent_version === CONSENT_VERSION && typeof r.consent_granted_at === "string"),
    ""
  );

  // B's pre-existing operator assignment (created above) — snapshot it so we
  // can prove the export did not touch it (no re-assign, no auto-balance).
  const assignmentBBefore = await db.studyAssignment.findUnique({ where: { userId: userB.id } });
  const expB = await api("/api/study/export?format=json", { headers: authB });
  check(
    "non-consented caller's personal export is EMPTY (rowCount 0, consent null)",
    expB.status === 200 && expB.body?.rowCount === 0 && (expB.body?.rows ?? []).length === 0 && expB.body?.consent === null,
    `rowCount ${expB.body?.rowCount} consent ${JSON.stringify(expB.body?.consent)}`
  );
  const armB = await db.studyAssignment.findUnique({ where: { userId: userB.id } });
  check(
    "personal export did NOT (re)assign an arm for the non-consented caller",
    armB !== null &&
      assignmentBBefore !== null &&
      armB.id === assignmentBBefore.id &&
      armB.assignedAt.getTime() === assignmentBBefore.assignedAt.getTime() &&
      armB.reason === "operator",
    `assignment before/after: ${assignmentBBefore?.id} / ${armB?.id}`
  );

  const expA = await api("/api/study/export?format=json", { headers: authA });
  const aRows = expA.body?.rows ?? [];
  check(
    "consented caller's personal export has their rows",
    expA.status === 200 && expA.body?.rowCount >= 1 && aRows.every((r: any) => r.participant === pseudoA),
    `rowCount ${expA.body?.rowCount}`
  );
  check(
    "personal export consent metadata: {version, grantedAt}",
    expA.body?.consent?.version === CONSENT_VERSION && typeof expA.body?.consent?.grantedAt === "string",
    `consent: ${JSON.stringify(expA.body?.consent)}`
  );

  const csvA = await api("/api/study/export?format=csv", { headers: authA });
  check(
    "CSV header ends with the consent provenance columns",
    csvA.status === 200 &&
      csvA.text.split("\r\n")[0].endsWith("consent_version,consent_granted_at"),
    `header: ${csvA.text.split("\r\n")[0]}`
  );

  // ─────────────────────────────────────────────── 4. RESEARCH OVERVIEW
  console.log("\n── 4. GET /api/research/overview ──");

  const ov = await api("/api/research/overview", { headers: authA });
  check("overview succeeds for an authenticated user", ov.status === 200 && ov.body?.success === true, `status ${ov.status}`);

  const b = ov.body ?? {};
  check(
    "top-level shape: generatedAt + window '30d' + deidentified",
    typeof b.generatedAt === "string" && b.window === "30d" && b.deidentified === true,
    ""
  );
  check(
    "participants: total/consented/revokedConsent/byArm/effectiveByArm",
    typeof b.participants?.total === "number" &&
      typeof b.participants?.consented === "number" &&
      typeof b.participants?.revokedConsent === "number" &&
      typeof b.participants?.byArm?.control === "number" &&
      typeof b.participants?.byArm?.smart === "number" &&
      typeof b.participants?.effectiveByArm?.control === "number" &&
      typeof b.participants?.effectiveByArm?.smart === "number",
    `participants: ${JSON.stringify(b.participants)}`
  );
  check(
    "participants.consented ≥ 1 (A consented) and effectiveByArm counts A",
    b.participants?.consented >= 1 &&
      b.participants.effectiveByArm.control + b.participants.effectiveByArm.smart >= 1,
    ""
  );
  check(
    "doses: total/byStatus(all five)/confirmationRate",
    typeof b.doses?.total === "number" &&
      typeof b.doses?.byStatus?.taken === "number" &&
      typeof b.doses?.byStatus?.skipped === "number" &&
      typeof b.doses?.byStatus?.missed === "number" &&
      typeof b.doses?.byStatus?.pending === "number" &&
      typeof b.doses?.byStatus?.delayed === "number" &&
      (b.doses.confirmationRate === null || typeof b.doses.confirmationRate === "number"),
    `doses: ${JSON.stringify(b.doses)}`
  );
  check(
    "doses includes this suite's 2 events (total ≥ 2)",
    b.doses?.total >= 2,
    `total ${b.doses?.total}`
  );
  check(
    "risk: modelVersion/predictionsLast30d/highRiskShare/riskBuckets(5)/mlAvailability",
    (b.risk?.modelVersion === null || typeof b.risk?.modelVersion?.version === "string") &&
      typeof b.risk?.predictionsLast30d === "number" &&
      (b.risk?.highRiskShare === null || typeof b.risk?.highRiskShare === "number") &&
      ["0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"].every(
        (k) => typeof b.risk?.riskBuckets?.[k] === "number"
      ) &&
      typeof b.risk?.mlAvailability === "boolean",
    `risk: ${JSON.stringify(b.risk)}`
  );
  const dq = b.dataQuality ?? {};
  check(
    "dataQuality: all six v5-item-44 checks present",
    ["missingTimestamps", "duplicateDoses", "invalidRiskScores", "unknownModelVersion", "timezoneMismatch", "missingArm"].every(
      (k) => typeof dq[k] === "number"
    ),
    `dataQuality: ${JSON.stringify(dq)}`
  );
  check(
    "dataQuality counts are clean on this dataset",
    dq.missingTimestamps === 0 && dq.duplicateDoses === 0 && dq.invalidRiskScores === 0,
    ""
  );
  check(
    "ai.perAgent: array with agent/requests30d/feedback mix",
    Array.isArray(b.ai?.perAgent) &&
      b.ai.perAgent.length > 0 &&
      b.ai.perAgent.every(
        (a: any) =>
          typeof a.agent === "string" &&
          typeof a.requests30d === "number" &&
          typeof a.successRate === "number" &&
          typeof a.feedback?.helpful === "number" &&
          typeof a.feedback?.unhelpful === "number" &&
          typeof a.feedback?.unsafe === "number"
      ),
    `agents: ${b.ai?.perAgent?.map((a: any) => a.agent).join(", ")}`
  );
  const medicalEntry = (b.ai?.perAgent ?? []).find((a: any) => a.agent === "medical");
  const routerEntry = (b.ai?.perAgent ?? []).find((a: any) => a.agent === "router");
  check(
    "ai.perAgent feedback reflects this suite's submissions (medical unhelpful, router unsafe)",
    medicalEntry && medicalEntry.feedback.unhelpful >= 1 && routerEntry && routerEntry.feedback.unsafe >= 1,
    `medical: ${JSON.stringify(medicalEntry?.feedback)} router: ${JSON.stringify(routerEntry?.feedback)}`
  );

  // De-identification: no user id / email anywhere (recursive equality scan
  // over values AND keys, plus a raw substring scan of the whole payload).
  const allUsers = await db.user.findMany({ select: { id: true, email: true } });
  const banned = new Set<string>(allUsers.flatMap((u) => [u.id, u.email]));
  const identifierHits = assertNoIdentifiers(b, banned);
  check(
    "no user id/email as any JSON value or key (recursive)",
    identifierHits.length === 0,
    identifierHits.slice(0, 3).join("; ")
  );
  const rawPayload = JSON.stringify(b);
  const substringHits = allUsers.filter(
    (u) => rawPayload.includes(u.id) || rawPayload.includes(u.email)
  );
  check(
    "no user id/email as a substring anywhere in the payload",
    substringHits.length === 0,
    substringHits.map((u) => u.email).join(", ")
  );

  const ovAnon = await api("/api/research/overview");
  check("overview requires auth (anonymous → 401)", ovAnon.status === 401, `status ${ovAnon.status}`);

  // ─────────────────────────────────────────────── 5. AI-MONITORING FEEDBACK
  console.log("\n── 5. GET /api/ai-monitoring (+ feedback section) ──");

  const mon = await api("/api/ai-monitoring", { headers: authA });
  check("ai-monitoring still succeeds", mon.status === 200 && mon.body?.success === true, `status ${mon.status}`);
  check(
    "original fields intact (agents/totals/recent/policyVersion)",
    Array.isArray(mon.body?.agents) && typeof mon.body?.totals?.requests === "number" && Array.isArray(mon.body?.recent) && typeof mon.body?.policyVersion === "string",
    ""
  );
  check(
    "new feedback section: windowDays 30 + perAgent counts + totals",
    mon.body?.feedback?.windowDays === 30 &&
      Array.isArray(mon.body?.feedback?.perAgent) &&
      typeof mon.body?.feedback?.totals?.helpful === "number" &&
      typeof mon.body?.feedback?.totals?.unhelpful === "number" &&
      typeof mon.body?.feedback?.totals?.unsafe === "number",
    `feedback: ${JSON.stringify(mon.body?.feedback)}`
  );
  const monMedical = (mon.body?.feedback?.perAgent ?? []).find((a: any) => a.agent === "medical");
  const monRouter = (mon.body?.feedback?.perAgent ?? []).find((a: any) => a.agent === "router");
  check(
    "monitoring feedback counts match this suite's submissions (medical unhelpful, router unsafe)",
    monMedical && monMedical.unhelpful >= 1 && monRouter && monRouter.unsafe >= 1,
    `medical: ${JSON.stringify(monMedical)} router: ${JSON.stringify(monRouter)}`
  );

  // ---------------------------------------------------------------- cleanup
  for (const user of [userA, userB]) {
    await db.aiFeedback.deleteMany({ where: { userId: user.id } });
    await db.studyConsent.deleteMany({ where: { userId: user.id } });
    await db.studyAssignment.deleteMany({ where: { userId: user.id } });
    await db.riskPrediction.deleteMany({ where: { userId: user.id } });
    await db.smartReminder.deleteMany({ where: { userId: user.id } });
    await db.doseEvent.deleteMany({ where: { userId: user.id } });
    await db.medication.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  const leftovers = await db.user.count({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
  check("self-cleanup: test users and all their rows removed", leftovers === 0, `${leftovers} left`);

  console.log(`\n════════ RESULT: ${passed} passed, ${failed} failed ════════`);
  if (failures.length > 0) {
    console.log("Failed checks:");
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main()
  .catch((err) => {
    console.error("SUITE ERROR:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
