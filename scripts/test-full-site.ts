/**
 * FULL-SITE test suite — backend/API coverage of every route group in the app.
 * Read-only wherever possible; additive POSTs (medication) are cleaned up after.
 * Run: bun run scripts/test-full-site.ts
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;
const failures: string[] = [];
let token = "";
let userId = "";
let createdMedId = "";
let reportId = "";

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
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extraHeaders };
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
    /* non-JSON (pdf etc.) */
  }
  return { status: r.status, json, text, headers: r.headers };
}

/* ───────────────────────── 1. HEALTH ───────────────────────── */
console.log("\n━━ 1. HEALTH & PLATFORM ━━");
{
  const r = await api("GET", "/api/healthz");
  check("healthz 200 ok", r.status === 200 && r.json?.status === "ok");
  check("healthz aiProviders present", !!r.json?.aiProviders);

  const rd = await api("GET", "/api/readyz");
  check("readyz 200", rd.status === 200, `got ${rd.status}`);

  const m = await api("GET", "/api/metrics");
  check("metrics 200 with content", m.status === 200 && (m.text?.length ?? 0) > 10);

  const lang = await api("GET", "/api/languages/supported");
  check("languages/supported 200", lang.status === 200 && (Array.isArray(lang.json) ? lang.json.length > 0 : !!lang.json?.languages || !!lang.json?.success));
}

/* ───────────────────────── 2. AUTH ───────────────────────── */
console.log("\n━━ 2. AUTHENTICATION ━━");
{
  const r = await api("POST", "/api/auth/login", undefined, {
    email: "demo@medsync.ai",
    password: "demo1234",
  });
  check("login demo 200 + token", r.status === 200 && !!r.json?.token);
  check("login returns user profile", !!r.json?.user?.id && !!r.json?.user?.email);
  token = r.json?.token ?? "";
  userId = r.json?.user?.id ?? "";

  const bad = await api("POST", "/api/auth/login", undefined, {
    email: "demo@medsync.ai",
    password: "wrong-password",
  });
  check("login wrong password rejected", bad.status === 400 || bad.status === 401, `got ${bad.status}`);

  const noAuth = await api("GET", "/api/preferences");
  check("unauthenticated request rejected", noAuth.status === 401 || noAuth.status === 400, `got ${noAuth.status}`);

  const signup = await api("POST", "/api/auth/signup", undefined, { email: "" });
  check("signup empty fields → 400 (no junk user)", signup.status === 400, `got ${signup.status}`);

  const signup2 = await api("POST", "/api/auth/signup", undefined, { name: "X", email: "bad-email", password: "short" });
  check("signup invalid email/short pw → 400", signup2.status === 400, `got ${signup2.status}`);

  const otp = await api("POST", "/api/auth/verify-otp", undefined, { email: "nobody@x.com", otp: "000000" });
  check("verify-otp unknown user 4xx", otp.status >= 400 && otp.status < 500, `got ${otp.status}`);
}

/* ───────────────────────── 3. USER DATA & ANALYTICS ───────────────────────── */
console.log("\n━━ 3. ANALYTICS / INTELLIGENCE / STREAK ━━");
{
  const h = await api("GET", "/api/health", token);
  check("health profile 200 (authenticated)", h.status === 200, `got ${h.status}`);

  const r = await api("GET", `/api/analytics/${userId}?days=30`, token);
  check("analytics overview 200", r.status === 200, `got ${r.status}`);

  const intel = await api("GET", "/api/intelligence/overview", token);
  check("intelligence/overview 200", intel.status === 200, `got ${intel.status}`);

  const streak = await api("POST", "/api/streak", token, { localuser: { id: userId } });
  check("streak 200", streak.status === 200, `got ${streak.status}`);

  const doses = await api("GET", `/api/dose-events?userId=${userId}&limit=5`, token);
  check("dose-events GET 200", doses.status === 200, `got ${doses.status}`);

  const notif = await api("POST", "/api/notification/today", token);
  check("notification/today 200", notif.status === 200 && notif.json?.success !== false, `got ${notif.status}`);

  const cal = await api("POST", "/api/calendar/status", token, { userId });
  check("calendar/status 200", cal.status === 200, `got ${cal.status}`);
}

/* ───────────────────────── 4. MEDICATIONS ───────────────────────── */
console.log("\n━━ 4. MEDICATIONS (CRUD + interactions) ━━");
{
  const today = await api("POST", "/api/medicine/today", token);
  check("medicine/today 200/201", today.status === 200 || today.status === 201, `got ${today.status}`);
  const medCount = Array.isArray(today.json?.data) ? today.json.data.length : Array.isArray(today.json?.todayMedicine) ? today.json.todayMedicine.length : -1;
  check("medicine/today returns list", medCount >= 0, `count=${medCount}`);

  const inter = await api("POST", "/api/medicine/check-interactions", token, { pillName: "Aspirin" });
  check("check-interactions 200", inter.status === 200 && inter.json?.success !== false, `got ${inter.status}`);

  const interBad = await api("POST", "/api/medicine/check-interactions", token, { pillName: "" });
  check("check-interactions empty → 400", interBad.status === 400, `got ${interBad.status}`);

  // ADD a test medication — REAL frontend contract (dosageDays/dosageTimes/frequency string)
  const add = await api("POST", "/api/medicine/add", token, {
    localuser: { id: userId },
    medication: {
      pillName: "TestFullSite Med",
      pillDescription: "temporary test medication",
      dosageDays: ["Monday", "Tuesday"],
      dosageTimes: [{ time: "09:00", remindBefore: "0", remindAfter: "0", status: "pending", takenAt: null }],
      dosageAmount: "10mg",
      frequency: "1 time a day",
      startDate: new Date().toISOString(),
      endDate: null,
      adherenceHistory: [],
    },
  });
  check("medicine/add 201 (frontend contract)", add.status === 201 && add.json?.success === true, `got ${add.status} ${JSON.stringify(add.json).slice(0, 120)}`);
  createdMedId = add.json?.data?.id ?? "";

  // API-consumer hardening: numeric frequency must be coerced, not 500
  const addNum = await api("POST", "/api/medicine/add", token, {
    localuser: { id: userId },
    medication: {
      pillName: "TestFullSite Med",
      dosageDays: ["Monday"],
      dosageTimes: [{ time: "09:00", remindBefore: "0", remindAfter: "0", status: "pending", takenAt: null }],
      frequency: 2,
    },
  });
  check("medicine/add numeric frequency coerced (no 500)", addNum.status === 201 || addNum.status === 200, `got ${addNum.status}`);

  const bulk = await api("POST", "/api/medicine/bulk", token, {
    localuser: { id: userId },
    text: "",
  });
  check("medicine/bulk handles empty text", bulk.status === 200 || bulk.status === 400, `got ${bulk.status}`);
}

/* ───────────────────────── 5. DOSE STATUS / REMINDERS ───────────────────────── */
console.log("\n━━ 5. REMINDER ENGINE & DOSE STATUS ━━");
{
  const tick = await api("POST", "/api/reminder-engine/tick", token, { userId });
  check("reminder-engine tick (self) 200", tick.status === 200, `got ${tick.status}`);

  const doseList = await api("GET", `/api/dose-events?userId=${userId}&limit=50`, token);
  const events = doseList.json?.data ?? doseList.json?.doseEvents ?? [];
  check("dose-events history readable", Array.isArray(events), `type=${typeof events}`);

  if (events.length > 0 && events[0].medicationId) {
    const st = await api("POST", "/api/medicine/status", token, {
      localuser: { id: userId },
      medId: events[0].medicationId,
      dosageTimeIndex: 0,
      status: "taken",
    });
    check("medicine/status (mark taken) 200", st.status === 200, `got ${st.status}`);
  } else {
    check("medicine/status — skipped (no events)", true);
  }
}

/* ───────────────────────── 6. REPORTS ───────────────────────── */
console.log("\n━━ 6. REPORTS (PDF + analyze + chat) ━━");
{
  const rep = await api("POST", "/api/report", token, {
    user: { id: userId },
    periodInDays: 7,
    language: "en",
  });
  check("report POST (PDF) 200", rep.status === 200 && rep.json?.success !== false, `got ${rep.status}`);

  const analyze = await fetch(`${BASE}/api/report/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: (() => {
      const fd = new FormData();
      fd.append("file", new File(["Hemoglobin 10.2 g/dL (ref 13-17), WBC 6.1, Platelets 245, Fasting glucose 108 mg/dL"], "lab.txt", { type: "text/plain" }));
      fd.append("language", "en");
      return fd;
    })(),
  });
  const analyzeJson = await analyze.json().catch(() => null);
  check("report/analyze (multipart file) 200/201", analyze.status === 200 || analyze.status === 201, `got ${analyze.status}`);
  check("report/analyze returns reportId", !!analyzeJson?.reportId);
  reportId = analyzeJson?.reportId ?? "";

  const chat = await api("POST", "/api/report/chat", token, {
    question: "What does the hemoglobin value mean?",
    reportId,
  });
  check("report/chat (with reportId) 200", chat.status === 200 && chat.json?.success !== false, `got ${chat.status}`);
}

/* ───────────────────────── 7. AI GATEWAY & SPECIALISTS ───────────────────────── */
console.log("\n━━ 7. AI GATEWAY (Smart Router + 4 specialists) ━━");
{
  const gw = await api("POST", "/api/agents", token, {
    input: "What is hypertension?",
    language: "en",
  });
  check("gateway routes medical 200", gw.status === 200 && (gw.json?.routedTo === "medical" || gw.json?.agent === "medical"), `got ${gw.status} routedTo=${gw.json?.routedTo ?? gw.json?.agent}`);

  const em = await api("POST", "/api/agents", token, {
    input: "ألم شديد في الصدر",
    language: "ar",
  });
  check("gateway Arabic → emergency priority", em.status === 200 && (em.json?.routedTo === "emergency" || em.json?.agent === "emergency" || em.json?.safety?.priority === "emergency"), `got ${em.status}`);

  for (const [name, path, q] of [
    ["medical", "/api/agents/medical", "What are early signs of anemia?"],
    ["emergency", "/api/agents/emergency", "I have mild chest pain since yesterday"],
    ["medicine", "/api/agents/medicine", "Can I take ibuprofen with food?"],
    ["personal-health", "/api/agents/personal-health", "How can I improve my sleep quality?"],
  ] as const) {
    const r = await api("POST", path, token, { input: q, language: "en" });
    const answer = (r.json?.output ?? r.json?.data?.answer ?? r.json?.answer ?? "") as string;
    const ok = r.status === 200 && r.json?.success !== false && answer.length > 20;
    check(`specialist ${name} answers`, ok, `got ${r.status} len=${answer.length}`);
  }

  const mon = await api("GET", "/api/ai-monitoring?hours=168", token);
  check("ai-monitoring 200 with agents", mon.status === 200 && Array.isArray(mon.json?.agents) && mon.json.agents.length >= 4, `got ${mon.status}`);

  // vision validation: non-multipart → 415
  const vis = await api("POST", "/api/agents/vision", token, { mode: "medication" });
  check("vision non-multipart → 4xx/415", vis.status === 400 || vis.status === 415, `got ${vis.status}`);
}

/* ───────────────────────── 8. TRANSLATION ───────────────────────── */
console.log("\n━━ 8. TRANSLATION ━━");
{
  const r = await api("POST", "/api/translate", token, {
    text: "Take one tablet daily with food",
    targetLanguage: "ar",
  });
  check("translate en→ar 200", r.status === 200 && r.json?.success !== false, `got ${r.status}`);

  const bad = await api("POST", "/api/translate", token, {});
  check("translate empty body → 400", bad.status === 400, `got ${bad.status}`);
}

/* ───────────────────────── 9. ML ───────────────────────── */
console.log("\n━━ 9. ML MODELS ━━");
{
  const r = await api("GET", "/api/ml/status", token);
  check("ml/status 200", r.status === 200, `got ${r.status}`);
  const hasActive = Array.isArray(r.json?.models) && r.json.models.some((m: any) => m?.isActive === true);
  check("ml/status reports active model", hasActive, `models=${JSON.stringify(r.json?.models ?? []).slice(0, 80)}`);
}

/* ───────────────────────── 10. STUDY ───────────────────────── */
console.log("\n━━ 10. STUDY / COHORT ━━");
{
  const st = await api("GET", `/api/study/status?userId=${userId}`, token);
  check("study/status 200", st.status === 200, `got ${st.status}`);

  const out = await api("GET", `/api/study/outcomes?userId=${userId}`, token);
  check("study/outcomes 200", out.status === 200, `got ${out.status}`);

  const exp = await api("GET", `/api/study/export?userId=${userId}`, token);
  check("study/export 200", exp.status === 200, `got ${exp.status}`);
}

/* ───────────────────────── 11. PREFERENCES ───────────────────────── */
console.log("\n━━ 11. PREFERENCES ━━");
{
  const get = await api("GET", "/api/preferences", token);
  check("preferences GET 200", get.status === 200, `got ${get.status}`);

  const put = await api("PUT", "/api/preferences", token, { showReadabilityScores: true });
  check("preferences PUT 200", put.status === 200, `got ${put.status}`);

  const langGet = await api("GET", "/api/languages/user", token);
  check("languages/user GET 200", langGet.status === 200, `got ${langGet.status}`);
}

/* ───────────────────────── 12. SECURITY (BOLA) ───────────────────────── */
console.log("\n━━ 12. SECURITY — cross-user access (BOLA) ━━");
{
  // another user's id (study cohort) must NOT be accessible with demo token
  const other = await api("GET", "/api/analytics/cmu8rmwjr0000on7mtmr2m09tXXXXXXXX", token);
  check("analytics foreign userId rejected", other.status === 401 || other.status === 403 || other.status === 404, `got ${other.status}`);

  const fake = await api("POST", "/api/medicine/add", token, {
    localuser: { id: "clxxxxxxxxxxxxxxxxxxxxx" },
    medication: { pillName: "Hack", dosageTime: ["09:00"], quantity: 1, frequency: 1, pillsPerDose: 1 },
  });
  check("medicine/add for other user rejected", fake.status === 401 || fake.status === 403, `got ${fake.status}`);

  const gwNoAuth = await api("POST", "/api/agents", undefined, { input: "hello" });
  check("agents without token rejected", gwNoAuth.status === 401, `got ${gwNoAuth.status}`);
}

/* ───────────────────────── CLEANUP ───────────────────────── */
console.log("\n━━ CLEANUP ━━");
{
  // No DELETE API exists (by design — meds are stopped, not deleted).
  // Remove the temporary test medication + ALL of its DoseEvents (the
  // reminder-engine tick may have materialized some between add and cleanup)
  // + the test report, directly via Prisma.
  const { PrismaClient } = await import(process.env.TEST_PRISMA_CLIENT ?? "@prisma/client");
  const prisma = new PrismaClient();
  try {
    const testMeds = await prisma.medication.findMany({
      where: { userId, pillName: "TestFullSite Med" },
      select: { id: true },
    });
    const medIds = testMeds.map((m: { id: string }) => m.id);
    // MR-11/MR-20 central fix (2026-10-01): delete the LEDGER rows that point
    // at those dose events FIRST (RiskPredictions + logged SmartReminders) —
    // previously this cleanup deleted DoseEvents only and left orphan
    // RiskPredictions behind on every run (84 accumulated before R0 repair).
    const evRows = await prisma.doseEvent.findMany({
      where: { medicationId: { in: medIds.length ? medIds : ["__none__"] } },
      select: { id: true },
    });
    const evIdList = evRows.map((e: { id: string }) => e.id);
    await prisma.riskPrediction.deleteMany({
      where: { doseEventId: { in: evIdList.length ? evIdList : ["__none__"] } },
    });
    await prisma.smartReminder.deleteMany({
      where: { doseEventId: { in: evIdList.length ? evIdList : ["__none__"] } },
    });
    const ev = await prisma.doseEvent.deleteMany({
      where: { medicationId: { in: medIds.length ? medIds : ["__none__"] } },
    });
    const removed = await prisma.medication.deleteMany({
      where: { userId, pillName: "TestFullSite Med" },
    });
    check("cleanup test medications removed", removed.count >= 1 && ev.count >= 0, `meds=${removed.count} events=${ev.count}`);
    if (reportId) {
      await prisma.report.deleteMany({ where: { id: reportId } });
      check("cleanup test report removed", true);
    } else {
      check("cleanup test report removed", false, "no reportId captured");
    }
  } catch (e) {
    check("cleanup test medication removed", false, String(e).slice(0, 120));
  } finally {
    await prisma.$disconnect();
  }
}

/* ───────────────────────── SUMMARY ───────────────────────── */
console.log("\n════════════════════════════════════════");
console.log(`  FULL-SITE RESULT: ${passed} passed / ${failed} failed / ${passed + failed} total`);
if (failures.length) {
  console.log("  Failures:");
  failures.forEach((f) => console.log(`   ✗ ${f}`));
}
console.log("════════════════════════════════════════");
process.exit(failed > 0 ? 1 : 0);
