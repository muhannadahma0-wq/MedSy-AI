/**
 * MEDICATION LIFECYCLE (CRUD) test suite — covers the management additions:
 *   POST /api/medicine/list   (all medications view)
 *   POST /api/medicine/update (partial edit + interaction shield + re-schedule)
 *   POST /api/medicine/delete (cascade cleanup)
 * Includes BOLA (foreign med id), validation and 401 checks. The test creates
 * its own medication and deletes it through the API itself — the final state
 * of the demo account is unchanged (self-cleaning).
 *
 * Run: bun run scripts/test-med-crud.ts
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEMO_ID = "cmu8rmwjr0000on7mtmr2m09t";
const FOREIGN_MED_ID = "cmumj9qtu0003o85zgx5a7d2i"; // belongs to another user

let passed = 0;
let failed = 0;
const failures: string[] = [];
let token = "";

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
  tok?: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (tok) headers.Authorization = `Bearer ${tok}`;
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
    /* ignore */
  }
  return { status: r.status, json };
}

/* ───────────────────────── 1. AUTH ───────────────────────── */
console.log("\n━━ 1. AUTH ━━");
{
  const r = await api("POST", "/api/auth/login", undefined, {
    email: "demo@medsync.ai",
    password: "demo1234",
  });
  check("login demo 200 + token", r.status === 200 && !!r.json?.token);
  token = r.json?.token ?? "";
}

/* ───────────────────────── 2. UNAUTHENTICATED ───────────────────────── */
console.log("\n━━ 2. UNAUTHENTICATED (401) ━━");
{
  const l = await api("POST", "/api/medicine/list");
  check("list without token → 401", l.status === 401, `got ${l.status}`);
  const u = await api("POST", "/api/medicine/update", undefined, { medId: "x", updates: {} });
  check("update without token → 401", u.status === 401, `got ${u.status}`);
  const d = await api("POST", "/api/medicine/delete", undefined, { medId: "x" });
  check("delete without token → 401", d.status === 401, `got ${d.status}`);
}

/* ───────────────────────── 3. LIST (all medications) ───────────────────────── */
console.log("\n━━ 3. LIST — /api/medicine/list ━━");
{
  const r = await api("POST", "/api/medicine/list", token, {});
  check("list 200 + success", r.status === 200 && r.json?.success === true, `got ${r.status}`);
  const data = r.json?.data;
  check("list returns data array", Array.isArray(data), `type=${typeof data}`);
  check("list has the full regimen (≥12 demo meds)", Array.isArray(data) && data.length >= 12, `count=${data?.length}`);
  const allOwned = Array.isArray(data) && data.every((m: any) => m.userId === DEMO_ID);
  check("every row belongs to the caller (no BOLA leak)", allOwned);
  const shaped = Array.isArray(data) && data.every(
    (m: any) => typeof m._id === "string" && typeof m.pillName === "string" && Array.isArray(m.dosageDays) && typeof m.scheduledToday === "boolean"
  );
  check("serialized shape + scheduledToday flag present", shaped);
  const d3 = Array.isArray(data) && data.find((m: any) => m.id === "cmu8rmwk20004on7mrncg3mii");
  check("known demo med (Vitamin D3) present with original id", !!d3);
}

/* ───────────────────────── 4. CREATE test subject ───────────────────────── */
console.log("\n━━ 4. CREATE — test medication via /api/medicine/add ━━");
let medId = "";
{
  const r = await api("POST", "/api/medicine/add", token, {
    medication: {
      pillName: "TestCrud Med",
      dosageDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      dosageTimes: [{ time: "23:45", remindBefore: "15m", remindAfter: "30m", status: "pending", takenAt: null }],
      dosageAmount: "100mg",
      frequency: "1 time a day",
      startDate: new Date().toISOString().split("T")[0],
    },
  });
  check("add test med 201", r.status === 201 && r.json?.success === true, `got ${r.status}`);
  medId = r.json?.data?._id ?? r.json?.data?.id ?? "";
  check("created id captured", !!medId);

  const list = await api("POST", "/api/medicine/list", token, {});
  const found = (list.json?.data || []).some((m: any) => m._id === medId);
  check("list now contains the test med", found);
}

/* ───────────────────────── 5. UPDATE — partial fields ───────────────────────── */
console.log("\n━━ 5. UPDATE — partial edit ━━");
{
  const r = await api("POST", "/api/medicine/update", token, {
    medId,
    updates: { dosageAmount: "250mg", frequency: "2 times a day" },
  });
  check("partial update 200", r.status === 200 && r.json?.success === true, `got ${r.status}`);
  check("dosageAmount applied", r.json?.data?.dosageAmount === "250mg");
  check("frequency applied", r.json?.data?.frequency === "2 times a day");
  check("pillName untouched by partial update", r.json?.data?.pillName === "TestCrud Med");

  const num = await api("POST", "/api/medicine/update", token, {
    medId,
    updates: { frequency: 3 },
  });
  check("numeric frequency coerced (no raw 500)", num.status === 200 && r.json?.data !== undefined, `got ${num.status}`);
}

/* ───────────────────────── 6. UPDATE — schedule re-materialization ───────────────────────── */
console.log("\n━━ 6. UPDATE — schedule change re-plans doses ━━");
{
  const r = await api("POST", "/api/medicine/update", token, {
    medId,
    updates: {
      dosageTimes: [{ time: "23:50", remindBefore: "10m", remindAfter: "45m", status: "pending", takenAt: null }],
    },
  });
  check("schedule update 200", r.status === 200 && r.json?.success === true, `got ${r.status}`);
  check("server reports re-materialized dose events", (r.json?.rescheduledDoseEvents ?? 0) >= 1, `got ${r.json?.rescheduledDoseEvents}`);

  const { PrismaClient } = await import(process.env.TEST_PRISMA_CLIENT ?? "@prisma/client");
  const prisma = new PrismaClient();
  try {
    const events = await prisma.doseEvent.findMany({
      where: { medicationId: medId, status: "pending" },
      select: { slotTime: true, scheduledAt: true },
    });
    check("DB has pending DoseEvents on the NEW slot (23:50)", events.length >= 1 && events.every((e: any) => e.slotTime === "23:50"), JSON.stringify(events.map((e: any) => e.slotTime)));
  } finally {
    await prisma.$disconnect();
  }
}

/* ───────────────────────── 7. UPDATE — safety shield on rename ───────────────────────── */
console.log("\n━━ 7. UPDATE — interaction shield on rename ━━");
{
  // Demo account already contains Aspirin → renaming to Warfarin is a MAJOR pair.
  const blocked = await api("POST", "/api/medicine/update", token, {
    medId,
    updates: { pillName: "Warfarin" },
  });
  check("rename to interacting drug → 409", blocked.status === 409, `got ${blocked.status}`);
  check("interactionDetected payload", blocked.json?.interactionDetected === true && Array.isArray(blocked.json?.interactions));
  check("major severity flagged + blocked", blocked.json?.highestSeverity === "major" && blocked.json?.blocked === true, `sev=${blocked.json?.highestSeverity}`);

  const override = await api("POST", "/api/medicine/update", token, {
    medId,
    updates: { pillName: "Warfarin", overrideInteractionWarning: true },
  });
  check("explicit override saves the rename (same contract as add)", override.status === 200 && override.json?.data?.pillName === "Warfarin", `got ${override.status}`);
}

/* ───────────────────────── 8. UPDATE — validation ───────────────────────── */
console.log("\n━━ 8. UPDATE — validation ━━");
{
  const empty = await api("POST", "/api/medicine/update", token, { medId, updates: {} });
  check("no updatable fields → 400", empty.status === 400, `got ${empty.status}`);

  const noName = await api("POST", "/api/medicine/update", token, { medId, updates: { pillName: "   " } });
  check("blank pillName → 400", noName.status === 400, `got ${noName.status}`);

  const noTimes = await api("POST", "/api/medicine/update", token, { medId, updates: { dosageTimes: [] } });
  check("empty dosageTimes → 400", noTimes.status === 400, `got ${noTimes.status}`);

  const noMed = await api("POST", "/api/medicine/update", token, { updates: { dosageAmount: "1mg" } });
  check("missing medId → 400", noMed.status === 400, `got ${noMed.status}`);
}

/* ───────────────────────── 9. BOLA — foreign medication ───────────────────────── */
console.log("\n━━ 9. BOLA — foreign medication id ━━");
{
  const up = await api("POST", "/api/medicine/update", token, {
    medId: FOREIGN_MED_ID,
    updates: { dosageAmount: "999mg" },
  });
  check("update foreign med → 404 (scoped lookup)", up.status === 404, `got ${up.status}`);

  const del = await api("POST", "/api/medicine/delete", token, { medId: FOREIGN_MED_ID });
  check("delete foreign med → 404 (scoped lookup)", del.status === 404, `got ${del.status}`);

  const ghost = await api("POST", "/api/medicine/delete", token, { medId: "cmu8rmwjy0002on7m1g9nXXXX" });
  check("delete nonexistent med → 404", ghost.status === 404, `got ${ghost.status}`);

  const noId = await api("POST", "/api/medicine/delete", token, {});
  check("delete without medId → 400", noId.status === 400, `got ${noId.status}`);
}

/* ───────────────────────── 10. DELETE — cascade cleanup ───────────────────────── */
console.log("\n━━ 10. DELETE — cascade cleanup ━━");
{
  const r = await api("POST", "/api/medicine/delete", token, { medId });
  check("delete 200 + success", r.status === 200 && r.json?.success === true, `got ${r.status}`);
  const removed = r.json?.data?.removed ?? {};
  check("reports removed DoseEvents count", typeof removed.doseEvents === "number" && removed.doseEvents >= 1, JSON.stringify(removed));
  check("reports removed SmartReminders count", typeof removed.smartReminders === "number");
  check("reports removed RiskPredictions count", typeof removed.riskPredictions === "number");

  const { PrismaClient } = await import(process.env.TEST_PRISMA_CLIENT ?? "@prisma/client");
  const prisma = new PrismaClient();
  try {
    const med = await prisma.medication.findUnique({ where: { id: medId } });
    check("medication row gone from DB", med === null);
    const events = await prisma.doseEvent.count({ where: { medicationId: medId } });
    check("0 orphan DoseEvents remain", events === 0, `left=${events}`);
    const list = await api("POST", "/api/medicine/list", token, {});
    const stillThere = (list.json?.data || []).some((m: any) => m._id === medId);
    check("list no longer contains the test med", !stillThere);
  } finally {
    await prisma.$disconnect();
  }
}

/* ───────────────────────── SUMMARY ───────────────────────── */
console.log("\n════════════════════════════════════════");
console.log(`  MED-CRUD RESULT: ${passed} passed / ${failed} failed / ${passed + failed} total`);
if (failures.length) {
  console.log("  Failures:");
  failures.forEach((f) => console.log(`   ✗ ${f}`));
}
console.log("════════════════════════════════════════");
process.exit(failed > 0 ? 1 : 0);
