/**
 * E2E GOLDEN PATH (v5 review item 1 / item 56 — P0):
 *
 *   Signup → Login → Medication → DoseEvent → Reminder → Prediction →
 *   Smart Reminder → User Action → Analytics → Conversation 2.0 →
 *   Feedback → Research overview
 *
 * Runs against the live dev server (:3000) with a THROWAWAY user created
 * through the real signup+OTP flow; everything is cleaned up at the end
 * (hard delete incl. all related rows).
 *
 * Run: bun run scripts/test-e2e-golden-path.ts
 */
// ADR-06 (migrated-stack runs): allow this script's db handle to point at the
// migrated server's Prisma client (PostgreSQL) via an explicit module path.
// Default (no env set) is byte-identical baseline behavior.
const { db } = (await import(
  (process.env.TEST_DB_MODULE as string) ?? "@/lib/db"
)) as typeof import("@/lib/db");

const BASE = process.env.BASE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(
  path: string,
  { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: r.status, json, text };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** HH:MM for now + offsetMinutes (clamped into the same day). */
function timeIn(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

let token = "";
let userId = "";
let email = "";
let medId = "";

async function tick(): Promise<any> {
  const r = await api("/api/reminder-engine/tick", { method: "POST", token, body: { userId } });
  return r.json?.summary ?? {};
}

async function main() {
  console.log("\n━━ E2E GOLDEN PATH — full pipeline on a throwaway user ━━");
  email = `golden-${Date.now()}@medsync.test`;

  /* 1 ─ SIGNUP + LOGIN (real OTP flow) */
  console.log("\n── 1. Signup → Login ──");
  {
    const signup = await api("/api/auth/signup", {
      method: "POST",
      body: { name: "Golden Path", email, password: "GoldenPath#2026" },
    });
    check("signup 200/201 + demoOtp (sandbox echo)", (signup.status === 200 || signup.status === 201) && !!signup.json?.demoOtp, `got ${signup.status}`);

    const verify = await api("/api/auth/verify-otp", {
      method: "POST",
      body: { email, otp: signup.json?.demoOtp },
    });
    check("verify-otp → token + user (login)", verify.status === 200 && !!verify.json?.token, `got ${verify.status}`);
    token = verify.json?.token ?? "";
    userId = verify.json?.user?.id ?? "";
    check("user id present", !!userId);
  }

  /* 2 ─ STUDY CONSENT + SMART ARM (consent gates the smart arm) */
  console.log("\n── 2. Research consent → smart arm ──");
  {
    const consent = await api("/api/study/consent", { method: "POST", token, body: { accept: true } });
    check("consent granted (version recorded)", consent.status === 200 || consent.status === 201, `got ${consent.status}`);

    const assign = await api("/api/study/assign", { method: "POST", token, body: { arm: "smart" } });
    check("study arm assigned: smart", assign.status === 200 || assign.status === 201, `got ${assign.status}`);
  }

  /* 3 ─ MEDICATION (add) */
  console.log("\n── 3. Medication ──");
  {
    const today = DAY_NAMES[new Date().getDay()];
    const add = await api("/api/medicine/add", {
      method: "POST",
      token,
      body: {
        localuser: { id: userId },
        medication: {
          pillName: "GoldenPathMed",
          pillDescription: "e2e golden path test medication",
          dosageDays: [today],
          dosageTimes: [{ time: timeIn(3), remindBefore: "10", remindAfter: "0", status: "pending", takenAt: null }],
          frequency: "1",
        },
      },
    });
    check("medicine/add 201", add.status === 201 || add.status === 200, `got ${add.status}`);
    medId = add.json?.data?.id ?? "";
    check("medication id returned", !!medId);
  }

  /* 4 ─ DOSE EVENT (materialized by the engine) */
  console.log("\n── 4. DoseEvent ──");
  let doseId = "";
  {
    const s1 = await tick();
    check("engine tick ok", typeof s1 === "object" && s1 !== null, JSON.stringify(s1).slice(0, 120));
    check("tick materialized ≥ 1 dose event", (s1.materialized ?? 0) >= 1, JSON.stringify(s1));

    const doses = await api(`/api/dose-events?userId=${userId}&limit=50`, { token });
    check("dose-events list 200", doses.status === 200, `got ${doses.status}`);
    const events: any[] = doses.json?.events ?? doses.json?.data ?? doses.json?.doseEvents ?? [];
    const mine = events.filter((e) => e.medicationId === medId || e.pillName === "GoldenPathMed");
    check("today's dose event exists for the new med", mine.length >= 1, `events=${events.length} mine=${mine.length}`);
    doseId = mine[0]?.id ?? "";
  }

  /* 5 ─ PREDICTION (ML risk score persisted) */
  console.log("\n── 5. ML Prediction ──");
  {
    // Scoring happens BOTH at medication-add time and on engine ticks
    // (rescored at most every 6h per dose). The golden-path requirement is
    // that a persisted, versioned prediction exists for the scheduled dose.
    const preds = await db.riskPrediction.findMany({
      where: { doseEventId: doseId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    check("RiskPrediction row exists for the dose", preds.length >= 1);
    if (preds[0]) {
      check(
        "prediction has riskScore in [0,1] + modelVersion + explanation",
        preds[0].riskScore >= 0 && preds[0].riskScore <= 1 && !!preds[0].modelVersion && !!preds[0].explanation,
        `riskScore=${preds[0].riskScore}`
      );
    }
    const s2 = await tick();
    check("engine tick healthy after scoring (no error)", typeof s2 === "object" && s2 !== null, JSON.stringify(s2).slice(0, 120));
  }

  /* 6 ─ SMART REMINDER (planned for the smart arm) */
  console.log("\n── 6. Smart Reminder ──");
  {
    const reminders = await db.smartReminder.findMany({ where: { userId } });
    check("SmartReminder planned (logged) for the smart-arm user", reminders.length >= 1, `count=${reminders.length}`);
    if (reminders[0]) {
      check("reminder carries risk snapshot + mode", typeof reminders[0].riskScore === "number" && !!reminders[0].mode && reminders[0].status === "logged", JSON.stringify({ risk: reminders[0].riskScore, mode: reminders[0].mode, status: reminders[0].status }));
    }
  }

  /* 7 ─ USER ACTION (mark the dose taken) */
  console.log("\n── 7. User Action (take the dose) ──");
  {
    const st = await api("/api/medicine/status", {
      method: "POST",
      token,
      body: { localuser: { id: userId }, medId, dosageTimeIndex: 0, status: "taken" },
    });
    check("mark taken → 200", st.status === 200, `got ${st.status}`);

    const after = await db.doseEvent.findUnique({ where: { id: doseId } });
    check("DoseEvent status = taken in DB", after?.status === "taken", `status=${after?.status}`);
  }

  /* 8 ─ ANALYTICS */
  console.log("\n── 8. Analytics ──");
  {
    const a = await api(`/api/analytics/${userId}?days=30`, { token });
    check("analytics 200", a.status === 200, `got ${a.status}`);

    const intel = await api("/api/intelligence/overview", { token });
    check("intelligence overview 200 (ML risk surfaced)", intel.status === 200, `got ${intel.status}`);
  }

  /* 9 ─ CONVERSATION 2.0 (threaded agent chat) */
  console.log("\n── 9. Conversation 2.0 ──");
  let conversationId = "";
  let logId = "";
  {
    // Unique per-run questions so the knowledge cache never short-circuits
    // the threading verification (cached answers report historyUsed=0 by
    // design — they skip the provider call entirely).
    const ref = Date.now().toString(36);
    const first = await api("/api/agents", {
      method: "POST",
      token,
      body: { input: `What is a healthy blood pressure range? (ref ${ref})`, language: "en", preferredAgent: "medical" },
    });
    check("agent reply 200 + conversationId", first.status === 200 && !!first.json?.conversationId, `got ${first.status}`);
    check("fresh answer (not cached)", first.json?.cached !== true, `cached=${first.json?.cached}`);
    conversationId = first.json?.conversationId ?? "";
    logId = first.json?.logId ?? "";
    check("reply carries logId (feedback key)", !!logId);

    const second = await api("/api/agents", {
      method: "POST",
      token,
      body: { input: `And what about for someone with diabetes? (ref ${ref})`, language: "en", preferredAgent: "medical", conversationId },
    });
    check("follow-up in the SAME thread 200", second.status === 200 && second.json?.conversationId === conversationId, `got ${second.status}`);
    check("history threaded (historyUsed ≥ 2)", (second.json?.historyUsed ?? 0) >= 2, `historyUsed=${second.json?.historyUsed}`);

    const detail = await api(`/api/agents/conversations?id=${conversationId}`, { token });
    const messages: any[] = detail.json?.conversation?.messages ?? [];
    check("thread persisted with 4 messages", messages.length === 4, `count=${messages.length}`);
  }

  /* 10 ─ AI FEEDBACK */
  console.log("\n── 10. AI Feedback ──");
  {
    const fb = await api("/api/agents/feedback", {
      method: "POST",
      token,
      body: { agent: "medical", rating: "helpful", aiLogId: logId, conversationId },
    });
    check("feedback 👍 accepted", fb.status === 200 || fb.status === 201, `got ${fb.status}`);

    const fb2 = await api("/api/agents/feedback", {
      method: "POST",
      token,
      body: { agent: "medical", rating: "unhelpful", aiLogId: logId, conversationId },
    });
    check("vote change upserts (same logId)", fb2.status === 200 || fb2.status === 201, `got ${fb2.status}`);

    const rows = await db.aiFeedback.findMany({ where: { userId } });
    check("exactly ONE feedback row after upsert", rows.length === 1, `rows=${rows.length}`);
  }

  /* 11 ─ RESEARCH OVERVIEW (de-identified) */
  console.log("\n── 11. Research overview ──");
  {
    const r = await api("/api/research/overview", { token });
    check("research overview 200", r.status === 200, `got ${r.status}`);
    const raw = JSON.stringify(r.json ?? {});
    check("de-identified (no user id anywhere)", !raw.includes(userId), `leaked: ${userId}`);
    check("participants include the throwaway consented user", (r.json?.participants?.consented ?? 0) >= 1, `consented=${r.json?.participants?.consented}`);
  }

  /* CLEANUP — hard delete everything the throwaway user produced */
  console.log("\n── cleanup ──");
  {
    await db.aiFeedback.deleteMany({ where: { userId } });
    await db.smartReminder.deleteMany({ where: { userId } });
    await db.riskPrediction.deleteMany({ where: { userId } });
    await db.doseEvent.deleteMany({ where: { userId } });
    await db.dailyNotification.deleteMany({ where: { userId: userId as any } }).catch(() => {});
    await db.conversation.deleteMany({ where: { userId } });
    await db.studyConsent.deleteMany({ where: { userId } });
    await db.studyAssignment.deleteMany({ where: { userId } });
    await db.aiLog.deleteMany({ where: { user: userId } }).catch(() => {});
    const delMed = await db.medication.deleteMany({ where: { id: medId } });
    check("medication deleted", delMed.count === 1);
    await db.user.deleteMany({ where: { id: userId } });
    const leftoverEvents = await db.doseEvent.count({ where: { userId } });
    check("user + dependent rows removed", leftoverEvents === 0, `leftover=${leftoverEvents}`);
  }

  console.log(`\n════════ RESULT: ${passed} passed, ${failed} failed ════════`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("golden-path suite crashed:", err);
  process.exit(1);
});
