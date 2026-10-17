/**
 * Cohort seed — 5 realistic patient personas for the adherence platform.
 *
 * Purpose (user request 2026-09-27): populate the platform with realistic
 * multi-user data so the ML models train on a meaningful multi-patient
 * dataset (temporal validation) and the study infrastructure has both arms
 * populated. All data is clearly-labeled behavioural demo data — the
 * platform's §18 honesty contract ("not clinical evidence") still applies.
 *
 * Personas (deterministic PRNG per persona — stable between runs):
 *   1. Layla  — high adherer (≈95%), on-time, ar UI
 *   2. Omar   — weekday 85% / weekend 45%, evenings worse, en UI
 *   3. Sara   — low adherer (≈45%), evening slot chronically missed, ar UI
 *   4. Khaled — improving trend (40% → 90% after day 15), en UI
 *   5. Nour   — elderly polypharmacy, morning slot weak (≈65% overall), ar UI
 *
 * Study arms (balanced with existing demo user = control):
 *   control: demo, Omar, Khaled   |   smart: Layla, Sara, Nour
 *
 * What each persona receives:
 *   - verified User (+ hashed password demo1234) + HealthProfile
 *   - 2-3 Medications with dosageTimes slots, instructions + Arabic
 *   - 30 days of history, dual-written:
 *       DoseEvent rows (source "migration")  ← intelligence/ML source of truth
 *       Medication.adherenceHistory JSON      ← analytics page
 *       Medication.dosageTimes statuses       ← today's dashboard view
 *   - StudyAssignment (reason "cohort-seed")
 *   - future pending DoseEvents materialize via ensureUpcomingDoseEvents
 *
 * Also cleans up agent-test artifact accounts (no data, test emails).
 * Idempotent: re-running deletes and re-creates the cohort users only.
 *
 * Run: bun run scripts/seed-cohort.ts
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/server/password";
import { ensureUpcomingDoseEvents } from "../src/lib/server/dose-events";

const db = new PrismaClient();

// ── deterministic PRNG ─────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── persona definitions ────────────────────────────────────────────────────
interface MedSpec {
  pillName: string;
  pillDescription: string;
  dosageAmount: string;
  frequency: string;
  slots: string[]; // "HH:MM" local server time
  originalInstructions: string;
  translatedAr?: string;
  doctorName: string;
}

interface Behavior {
  /** Returns the outcome for one scheduled dose. */
  (
    rand: () => number,
    ctx: { dayIndex: number; hour: number; isWeekend: boolean; slot: string }
  ): { status: "taken" | "delayed" | "missed" | "skipped"; delayMin: number; skipReason?: string };
}

interface Persona {
  key: string;
  seed: number;
  name: string;
  email: string;
  lang: "en" | "ar";
  arm: "control" | "smart";
  profile: { age: number; gender: string; height: number; weight: number; bloodGroup: string; conditions: string[]; allergies: string[] };
  meds: MedSpec[];
  behavior: Behavior;
}

const HISTORICAL_DAYS = 30;

const personas: Persona[] = [
  {
    key: "layla",
    seed: 101,
    name: "Layla Hassan",
    email: "layla@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 34, gender: "female", height: 164, weight: 58, bloodGroup: "O+", conditions: ["Hypothyroidism"], allergies: [] },
    meds: [
      {
        pillName: "Levothyroxine",
        pillDescription: "Thyroid hormone replacement",
        dosageAmount: "50mcg",
        frequency: "Once a day",
        slots: ["08:00"],
        originalInstructions: "Take on an empty stomach, 30-60 minutes before breakfast.",
        translatedAr: "تناوليه على معدة فارغة، 30-60 دقيقة قبل الإفطار.",
        doctorName: "Dr. Salim Haddad",
      },
      {
        pillName: "Vitamin D3",
        pillDescription: "Cholecalciferol supplement",
        dosageAmount: "1000 IU",
        frequency: "Once a day",
        slots: ["20:00"],
        originalInstructions: "Take with the largest meal of the day for better absorption.",
        translatedAr: "تناولي مع أكبر وجبة في اليوم لتحسين الامتصاص.",
        doctorName: "Dr. Salim Haddad",
      },
    ],
    behavior: (rand) => {
      // high adherer (documented ≈95%+): missed kept rare so the profile
      // stays above the 85% sanity threshold even on unlucky PRNG stretches
      const r = rand();
      if (r < 0.015) return { status: "missed", delayMin: 0 };
      if (r < 0.115) return { status: "delayed", delayMin: 35 + Math.floor(rand() * 50) };
      return { status: "taken", delayMin: -10 + Math.floor(rand() * 35) };
    },
  },
  {
    key: "omar",
    seed: 202,
    name: "Omar Farouk",
    email: "omar@medsync.ai",
    lang: "en",
    arm: "control",
    profile: { age: 47, gender: "male", height: 176, weight: 88, bloodGroup: "A+", conditions: ["Type 2 Diabetes", "Hypertension"], allergies: ["Penicillin"] },
    meds: [
      {
        pillName: "Metformin",
        pillDescription: "Biguanide antidiabetic",
        dosageAmount: "850mg",
        frequency: "Twice a day",
        slots: ["08:00", "21:00"],
        originalInstructions: "Take with meals to reduce stomach upset.",
        doctorName: "Dr. Rania Kamal",
      },
      {
        pillName: "Atorvastatin",
        pillDescription: "HMG-CoA reductase inhibitor",
        dosageAmount: "20mg",
        frequency: "Once at night",
        slots: ["21:00"],
        originalInstructions: "Take in the evening; avoid grapefruit juice.",
        doctorName: "Dr. Rania Kamal",
      },
    ],
    behavior: (rand, { isWeekend, hour }) => {
      // weekday 85% / weekend 45%; evening slots slightly worse
      let confirm = isWeekend ? 0.45 : 0.85;
      if (hour >= 18) confirm -= 0.08;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.3
          ? { status: "delayed", delayMin: 35 + Math.floor(rand() * 40) }
          : { status: "taken", delayMin: -5 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.1) return { status: "skipped", delayMin: 15 + Math.floor(rand() * 30), skipReason: "forgot" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "sara",
    seed: 303,
    name: "Sara Ali",
    email: "sara@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 28, gender: "female", height: 168, weight: 62, bloodGroup: "B+", conditions: ["Major depressive disorder (in remission)"], allergies: ["Latex"] },
    meds: [
      {
        pillName: "Sertraline",
        pillDescription: "SSRI antidepressant",
        dosageAmount: "50mg",
        frequency: "Once a day",
        slots: ["09:00"],
        originalInstructions: "Take in the morning with food; do not stop abruptly.",
        translatedAr: "تناوليه صباحاً مع الطعام؛ لا تتوقفي عنه فجأة.",
        doctorName: "Dr. Huda Nassar",
      },
      {
        pillName: "Vitamin B12",
        pillDescription: "Cyanocobalamin supplement",
        dosageAmount: "1000mcg",
        frequency: "Once a day",
        slots: ["19:00"],
        originalInstructions: "Dissolve under the tongue after dinner.",
        translatedAr: "ذوّبي القرص تحت اللسان بعد العشاء.",
        doctorName: "Dr. Huda Nassar",
      },
    ],
    behavior: (rand, { hour }) => {
      // overall ≈45%; evening slot chronically missed (slotMissStreak signal)
      const confirm = hour >= 18 ? 0.3 : 0.6;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.4
          ? { status: "delayed", delayMin: 60 + Math.floor(rand() * 90) }
          : { status: "taken", delayMin: 0 + Math.floor(rand() * 20) };
      }
      if (rand() < 0.07) return { status: "skipped", delayMin: 20 + Math.floor(rand() * 40), skipReason: rand() < 0.5 ? "side_effects" : "forgot" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "khaled",
    seed: 404,
    name: "Khaled Nabil",
    email: "khaled@medsync.ai",
    lang: "en",
    arm: "control",
    profile: { age: 55, gender: "male", height: 172, weight: 95, bloodGroup: "AB+", conditions: ["Hypertension", "Hyperlipidemia"], allergies: [] },
    meds: [
      {
        pillName: "Amlodipine",
        pillDescription: "Calcium channel blocker",
        dosageAmount: "5mg",
        frequency: "Once a day",
        slots: ["07:30"],
        originalInstructions: "Take at the same time each morning.",
        doctorName: "Dr. Fadi Amin",
      },
      {
        pillName: "Atorvastatin",
        pillDescription: "HMG-CoA reductase inhibitor",
        dosageAmount: "40mg",
        frequency: "Once at night",
        slots: ["19:30"],
        originalInstructions: "Take in the evening; report muscle pain promptly.",
        doctorName: "Dr. Fadi Amin",
      },
    ],
    behavior: (rand, { dayIndex }) => {
      // improving trend: first 2 weeks ≈40%, then ≈95% (adherenceRate7d signal;
      // 0.95 keeps the last-14d window safely above the 80% sanity threshold)
      const confirm = dayIndex >= 15 ? 0.95 : 0.4;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.2
          ? { status: "delayed", delayMin: 35 + Math.floor(rand() * 35) }
          : { status: "taken", delayMin: -5 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.08) return { status: "skipped", delayMin: 10 + Math.floor(rand() * 30), skipReason: "not_needed" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "nour",
    seed: 505,
    name: "Nour Ibrahim",
    email: "nour@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 68, gender: "female", height: 158, weight: 70, bloodGroup: "O-", conditions: ["Atrial fibrillation", "Heart failure (NYHA II)", "Hypertension"], allergies: ["Sulfa drugs"] },
    meds: [
      {
        pillName: "Metoprolol",
        pillDescription: "Beta blocker",
        dosageAmount: "50mg",
        frequency: "Twice a day",
        slots: ["07:00", "21:00"],
        originalInstructions: "Do not stop suddenly; monitor pulse regularly.",
        translatedAr: "لا تتوقفي عنه فجأة؛ راقبي النبض بانتظام.",
        doctorName: "Dr. Samir Odeh",
      },
      {
        pillName: "Furosemide",
        pillDescription: "Loop diuretic",
        dosageAmount: "40mg",
        frequency: "Once in the morning",
        slots: ["07:00"],
        originalInstructions: "Take in the morning to avoid night urination.",
        translatedAr: "تناوليه صباحاً لتجنب التبول الليلي.",
        doctorName: "Dr. Samir Odeh",
      },
      {
        pillName: "Apixaban",
        pillDescription: "Direct oral anticoagulant",
        dosageAmount: "2.5mg",
        frequency: "Once at midday",
        slots: ["14:00"],
        originalInstructions: "Take exactly as scheduled; report any unusual bleeding.",
        translatedAr: "التزمي بالمواعيد بدقة؛ أبلغي عن أي نزيف غير معتاد.",
        doctorName: "Dr. Samir Odeh",
      },
    ],
    behavior: (rand, { hour }) => {
      // elderly polypharmacy ≈65%; morning slot weakest (50%)
      const confirm = hour < 10 ? 0.5 : 0.75;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.25
          ? { status: "delayed", delayMin: 40 + Math.floor(rand() * 55) }
          : { status: "taken", delayMin: 0 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.06) return { status: "skipped", delayMin: 15 + Math.floor(rand() * 35), skipReason: "doctor" };
      return { status: "missed", delayMin: 0 };
    },
  },
];

// ── test-artifact accounts to clean up (no data; created by agent tests) ──
const ARTIFACT_EMAILS = [
  "testuser@example.com",
  "test-4a@medsync.ai",
  "light-test-5a@medsync.ai",
  "arabic-test6b@medsync.ai",
];

// ── helpers ────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const atLocalTime = (d: Date, slot: string) => {
  const [h, m] = slot.split(":").map(Number);
  const c = new Date(d);
  c.setHours(h, m, 0, 0);
  return c;
};

interface Outcome { status: "taken" | "delayed" | "missed" | "skipped"; delayMin: number; skipReason?: string }

async function seedPersona(p: Persona, now: Date) {
  const rand = mulberry32(p.seed);

  // 1. user (idempotent: wipe + recreate)
  const existing = await db.user.findUnique({ where: { email: p.email } });
  if (existing) {
    await db.doseEvent.deleteMany({ where: { userId: existing.id } });
    await db.smartReminder.deleteMany({ where: { userId: existing.id } });
    await db.riskPrediction.deleteMany({ where: { userId: existing.id } });
    await db.studyAssignment.deleteMany({ where: { userId: existing.id } });
    await db.medication.deleteMany({ where: { userId: existing.id } });
    await db.healthProfile.deleteMany({ where: { user: existing.id } });
    await db.user.delete({ where: { id: existing.id } });
  }
  const user = await db.user.create({
    data: {
      name: p.name,
      email: p.email,
      password: hashPassword("demo1234"),
      isVerified: true,
      preferredLanguage: p.lang,
      timeZone: "Asia/Hebron",
      createdAt: new Date(now.getTime() - (HISTORICAL_DAYS + 5) * 24 * 3600 * 1000),
    },
  });

  // 2. health profile
  await db.healthProfile.create({
    data: {
      user: user.id,
      age: p.profile.age,
      gender: p.profile.gender,
      height: p.profile.height,
      weight: p.profile.weight,
      bloodGroup: p.profile.bloodGroup,
      medicalConditions: JSON.stringify(p.profile.conditions),
      allergies: JSON.stringify(p.profile.allergies),
      medications: JSON.stringify(p.meds.map((m) => m.pillName)),
      emergencyContact: JSON.stringify({ name: "Family contact", phone: "+970-5XX-XXX-XXX", relation: "family" }),
    },
  });

  // 3. study arm
  await db.studyAssignment.create({
    data: { userId: user.id, arm: p.arm, reason: "cohort-seed" },
  });

  // 4. history — iterate days from oldest to today
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const adherenceByMed = new Map<string, { date: string; time: string; status: string; takenAt: string | null }[]>();

  for (const med of p.meds) {
    const medication = await db.medication.create({
      data: {
        userId: user.id,
        pillName: med.pillName,
        pillDescription: med.pillDescription,
        dosageAmount: med.dosageAmount,
        frequency: med.frequency,
        dosageDays: JSON.stringify(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
        dosageTimes: JSON.stringify(
          med.slots.map((time) => ({ time, remindBefore: "15m", remindAfter: "30m", status: "pending", takenAt: null }))
        ),
        startDate: new Date(today.getTime() - (HISTORICAL_DAYS + 3) * 24 * 3600 * 1000),
        originalInstructions: med.originalInstructions,
        translatedAr: med.translatedAr ?? null,
        doctorName: med.doctorName,
        adherenceHistory: JSON.stringify([]),
      },
    });
    adherenceByMed.set(medication.id, []);

    for (let dayIndex = HISTORICAL_DAYS; dayIndex >= 0; dayIndex--) {
      const day = new Date(today.getTime() - dayIndex * 24 * 3600 * 1000);
      const isToday = dayIndex === 0;
      const weekday = day.getDay();
      const isWeekend = weekday === 0 || weekday === 6;

      for (const slot of med.slots) {
        const scheduledAt = atLocalTime(day, slot);
        const hour = scheduledAt.getHours();

        if (isToday && scheduledAt.getTime() > now.getTime()) continue; // future slot today → pending (materializer handles)

        const out: Outcome = isToday && scheduledAt.getTime() > now.getTime() - 2 * 3600 * 1000
          ? { status: "pending", delayMin: 0 } as unknown as Outcome // very recent slot stays pending (grace)
          : p.behavior(rand, { dayIndex: HISTORICAL_DAYS - dayIndex, hour, isWeekend, slot });

        if ((out as { status: string }).status === "pending") continue;

        const actualAt =
          out.status === "missed"
            ? null
            : new Date(scheduledAt.getTime() + out.delayMin * 60 * 1000);
        const delayMinutes =
          // signed delay (schema: actualAt − scheduledAt, positive = late) —
          // negative = taken early; verify-data.ts checks dm ≈ actualAt−scheduledAt
          out.status === "taken" || out.status === "delayed" ? Math.round(out.delayMin) : null;

        // 4a. DoseEvent (source of truth)
        await db.doseEvent.create({
          data: {
            userId: user.id,
            medicationId: medication.id,
            scheduledAt,
            actualAt,
            status: out.status,
            delayMinutes,
            skipReason: out.status === "skipped" ? out.skipReason ?? "other" : null,
            source: "migration",
            slotTime: slot,
          },
        });

        // 4b. legacy adherenceHistory (analytics page)
        const adherence = adherenceByMed.get(medication.id)!;
        adherence.push({
          date: dateKey(day),
          time: slot,
          status: out.status,
          takenAt: actualAt ? actualAt.toISOString() : null,
        });

        // 4c. today's dosageTimes status (dashboard view)
        if (isToday) {
          const times = JSON.parse(
            (await db.medication.findUnique({ where: { id: medication.id }, select: { dosageTimes: true } }))!.dosageTimes as string
          ) as { time: string; remindBefore: string; remindAfter: string; status: string; takenAt: string | null; skipReason?: string | null }[];
          const t = times.find((x) => x.time === slot);
          if (t) {
            t.status = out.status;
            t.takenAt = actualAt ? actualAt.toISOString() : null;
            if (out.status === "skipped") t.skipReason = out.skipReason ?? "other";
            await db.medication.update({
              where: { id: medication.id },
              data: { dosageTimes: JSON.stringify(times) },
            });
          }
        }
      }
    }

    await db.medication.update({
      where: { id: medication.id },
      data: { adherenceHistory: JSON.stringify(adherenceByMed.get(medication.id)) },
    });
  }

  // 5. future pending events (+7d) via the real materializer
  const materialized = await ensureUpcomingDoseEvents(user.id);

  return { email: p.email, arm: p.arm, materialized };
}

async function main() {
  const now = new Date();
  console.log("Seeding MedSync AI cohort (5 personas, 30 days each)…");

  // 0. clean agent-test artifacts (keep real signups)
  for (const email of ARTIFACT_EMAILS) {
    const u = await db.user.findUnique({ where: { email } });
    if (u) {
      const medCount = await db.medication.count({ where: { userId: u.id } });
      if (medCount === 0) {
        await db.user.delete({ where: { id: u.id } });
        console.log(`  cleaned test artifact: ${email}`);
      }
    }
  }

  const results = [];
  for (const p of personas) {
    const r = await seedPersona(p, now);
    results.push(r);
    console.log(`  seeded ${r.email} (arm=${r.arm}, future events materialized=${r.materialized})`);
  }

  // summary
  const users = await db.user.findMany({ select: { id: true, email: true } });
  let totalDoses = 0;
  const byStatus: Record<string, number> = {};
  for (const u of users) {
    const grouped = await db.doseEvent.groupBy({ by: ["status"], where: { userId: u.id }, _count: true });
    for (const g of grouped) {
      totalDoses += g._count;
      byStatus[g.status] = (byStatus[g.status] ?? 0) + g._count;
    }
  }
  const arms = await db.studyAssignment.groupBy({ by: ["arm"], _count: true });
  console.log("\nCOHORT SUMMARY");
  console.log(`  users: ${users.length}`);
  console.log(`  dose events: ${totalDoses} → ${JSON.stringify(byStatus)}`);
  console.log(`  study arms: ${JSON.stringify(arms.map((a) => ({ arm: a.arm, n: a._count })))}`);
  console.log("\nDone. Next: POST /api/reminder-engine/tick then POST /api/ml/train");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
