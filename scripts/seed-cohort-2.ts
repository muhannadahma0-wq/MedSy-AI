/**
 * Cohort seed v2 — 7 additional patient personas (extends seed-cohort.ts).
 *
 * Purpose (user request 2026-09-27 "نفذ الخطة"): enlarge the behavioural
 * dataset so the ML models train on richer signal diversity. All data is
 * clearly-labeled behavioural demo data — the §18 honesty contract
 * ("not clinical evidence") still applies.
 *
 * New personas (deterministic PRNG per persona — stable between runs):
 *   6.  Amina  — shift nurse, 2-week rotation: normal weeks ≈80%,
 *                night-shift weeks ≈40% (morning slots collapse), ar UI
 *   7.  Yousef — high adherer ≈92% but a long 120-180 min delay every
 *                ~10 days (travel days), en UI
 *   8.  Farah  — adolescent asthma: school days ≈75%, weekends ≈35%,
 *                morning slot rushed, ar UI
 *   9.  Tariq  — declining trend 90% → 40% (adherence fatigue signal), en
 *  10.  Huda   — post-op: finished 7-day antibiotic course + ongoing PPI
 *                (course window support, endDate in the past), ar
 *  11.  Rami   — GERD: ≈88% confirmed but chronically delayed 40-70 min
 *                (delay-consistency signal), en
 *  12.  Dalia  — RA: weekly Methotrexate (Monday only) near-perfect +
 *                daily med ≈70% with morning stiffness delays, ar
 *
 * Study arms (with cohort v1: control 6 / smart 7 incl. demo):
 *   control: Yousef, Tariq, Rami
 *   smart:   Amina, Farah, Huda, Dalia
 *
 * New mechanics vs v1:
 *   - MedSpec.days   → weekly dosing (dosageDays respected in the loop)
 *   - MedSpec.window → [fromDayIndex, toDayIndex] course window; the med
 *                      gets an endDate and events only inside the window
 *
 * Idempotent: re-running deletes and re-creates these 7 users only.
 * Run: bun run scripts/seed-cohort-2.ts
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
  /** Days of the week the dose is taken. Default: every day. */
  days?: string[];
  /** [fromDayIndex, toDayIndex] course window in the 30-day history. Default: whole range. */
  window?: [number, number];
  originalInstructions: string;
  translatedAr?: string;
  doctorName: string;
}

interface Behavior {
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
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const personas: Persona[] = [
  {
    key: "amina",
    seed: 606,
    name: "Amina Zreiqi",
    email: "amina@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 31, gender: "female", height: 162, weight: 55, bloodGroup: "A-", conditions: ["Asthma"], allergies: ["Aspirin"] },
    meds: [
      {
        pillName: "Salbutamol inhaler",
        pillDescription: "Short-acting beta agonist (rescue)",
        dosageAmount: "100mcg/puff",
        frequency: "Twice a day",
        slots: ["07:30", "22:00"],
        originalInstructions: "Two puffs morning and night; rinse mouth after use.",
        translatedAr: "بختان صباحاً ومساءً؛ اشطفي الفم بعد الاستخدام.",
        doctorName: "Dr. Lina Zu'bi",
      },
      {
        pillName: "Montelukast",
        pillDescription: "Leukotriene receptor antagonist",
        dosageAmount: "10mg",
        frequency: "Once at night",
        slots: ["22:00"],
        originalInstructions: "Take in the evening; may cause vivid dreams.",
        translatedAr: "تناوليه مساءً؛ قد يسبب أحلاماً واضحة.",
        doctorName: "Dr. Lina Zu'bi",
      },
    ],
    behavior: (rand, { hour, dayIndex }) => {
      // 2-week rotation: night-shift weeks ≈40% (morning slots collapse to 20%)
      const nightShiftWeek = Math.floor(dayIndex / 7) % 2 === 1;
      const confirm = nightShiftWeek ? (hour < 12 ? 0.2 : 0.55) : 0.8;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.35
          ? { status: "delayed", delayMin: 45 + Math.floor(rand() * 75) }
          : { status: "taken", delayMin: -5 + Math.floor(rand() * 30) };
      }
      if (rand() < 0.08) return { status: "skipped", delayMin: 15 + Math.floor(rand() * 30), skipReason: "sleeping" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "yousef",
    seed: 707,
    name: "Yousef Hamdan",
    email: "yousef@medsync.ai",
    lang: "en",
    arm: "control",
    profile: { age: 42, gender: "male", height: 180, weight: 83, bloodGroup: "B-", conditions: ["Migraine prophylaxis"], allergies: [] },
    meds: [
      {
        pillName: "Topiramate",
        pillDescription: "Antiepileptic / migraine prophylactic",
        dosageAmount: "50mg",
        frequency: "Twice a day",
        slots: ["08:00", "20:00"],
        originalInstructions: "Swallow whole; maintain adequate hydration.",
        doctorName: "Dr. Maysoon Sulieman",
      },
      {
        pillName: "Magnesium oxide",
        pillDescription: "Mineral supplement",
        dosageAmount: "400mg",
        frequency: "Once at night",
        slots: ["20:00"],
        originalInstructions: "Take with dinner.",
        doctorName: "Dr. Maysoon Sulieman",
      },
    ],
    behavior: (rand, { dayIndex }) => {
      // ≈92% overall; every ~10th day a long 120-180 min delay (travel)
      const isTravelDay = dayIndex % 10 === 4;
      const r = rand();
      if (isTravelDay && r < 0.8) {
        return rand() < 0.7
          ? { status: "delayed", delayMin: 120 + Math.floor(rand() * 60) }
          : { status: "missed", delayMin: 0 };
      }
      if (r < 0.92) {
        return rand() < 0.15
          ? { status: "delayed", delayMin: 35 + Math.floor(rand() * 25) }
          : { status: "taken", delayMin: -10 + Math.floor(rand() * 30) };
      }
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "farah",
    seed: 808,
    name: "Farah Mustafa",
    email: "farah@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 16, gender: "female", height: 158, weight: 50, bloodGroup: "AB-", conditions: ["Asthma", "Allergic rhinitis"], allergies: ["Dust mites"] },
    meds: [
      {
        pillName: "Budesonide/Formoterol",
        pillDescription: "Inhaled corticosteroid + LABA (maintenance)",
        dosageAmount: "160/4.5mcg",
        frequency: "Twice a day",
        slots: ["07:00", "20:00"],
        originalInstructions: "Inhale morning and evening; rinse mouth after each use.",
        translatedAr: "استنشكي صباحاً ومساءً؛ اشطفي الفم بعد كل استخدام.",
        doctorName: "Dr. Dina Karam",
      },
      {
        pillName: "Cetirizine",
        pillDescription: "Second-generation antihistamine",
        dosageAmount: "10mg",
        frequency: "Once at night",
        slots: ["21:00"],
        originalInstructions: "Take at bedtime during allergy season.",
        translatedAr: "تناوليه عند النوم خلال موسم الحساسية.",
        doctorName: "Dr. Dina Karam",
      },
    ],
    behavior: (rand, { isWeekend, hour }) => {
      // school days ≈75% (morning slot rushed 65%), weekends ≈35%
      let confirm = isWeekend ? 0.35 : 0.75;
      if (!isWeekend && hour < 9) confirm -= 0.1;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.25
          ? { status: "delayed", delayMin: 40 + Math.floor(rand() * 45) }
          : { status: "taken", delayMin: 0 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.06) return { status: "skipped", delayMin: 10 + Math.floor(rand() * 30), skipReason: "felt_fine" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "tariq",
    seed: 909,
    name: "Tariq Salem",
    email: "tariq@medsync.ai",
    lang: "en",
    arm: "control",
    profile: { age: 51, gender: "male", height: 174, weight: 91, bloodGroup: "O+", conditions: ["Type 2 Diabetes", "Diabetic neuropathy"], allergies: [] },
    meds: [
      {
        pillName: "Insulin glargine",
        pillDescription: "Long-acting basal insulin",
        dosageAmount: "18 units",
        frequency: "Once at bedtime",
        slots: ["22:30"],
        originalInstructions: "Inject subcutaneously at bedtime; rotate sites.",
        doctorName: "Dr. Abeer Mansour",
      },
      {
        pillName: "Pregabalin",
        pillDescription: "Neuropathic pain agent",
        dosageAmount: "75mg",
        frequency: "Twice a day",
        slots: ["09:00", "21:00"],
        originalInstructions: "May cause dizziness; avoid driving until stable.",
        doctorName: "Dr. Abeer Mansour",
      },
    ],
    behavior: (rand, { dayIndex }) => {
      // declining trend 90% → 40% across the month (adherence fatigue)
      const frac = dayIndex / HISTORICAL_DAYS;
      const confirm = 0.9 - 0.5 * frac;
      const r = rand();
      if (r < confirm) {
        return rand() < 0.3
          ? { status: "delayed", delayMin: 35 + Math.floor(rand() * 40) }
          : { status: "taken", delayMin: -5 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.09) return { status: "skipped", delayMin: 10 + Math.floor(rand() * 30), skipReason: "side_effects" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "huda",
    seed: 1010,
    name: "Huda Barakat",
    email: "huda@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 59, gender: "female", height: 166, weight: 74, bloodGroup: "A+", conditions: ["GERD", "Status post cholecystectomy"], allergies: ["Codeine"] },
    meds: [
      {
        pillName: "Amoxicillin-Clavulanate",
        pillDescription: "Beta-lactam antibacterial (post-op course)",
        dosageAmount: "875/125mg",
        frequency: "Twice a day",
        slots: ["08:00", "20:00"],
        window: [3, 9], // days 3-9 of the 30-day history (finished course)
        originalInstructions: "Complete the full course even if you feel better.",
        translatedAr: "أكملي الكورة كاملة حتى لو شعرت بتحسن.",
        doctorName: "Dr. Wa'il Thawabteh",
      },
      {
        pillName: "Pantoprazole",
        pillDescription: "Proton pump inhibitor",
        dosageAmount: "40mg",
        frequency: "Once before breakfast",
        slots: ["07:00"],
        originalInstructions: "Take 30 minutes before the first meal of the day.",
        translatedAr: "تناوليه قبل 30 دقيقة من أول وجبة في اليوم.",
        doctorName: "Dr. Wa'il Thawabteh",
      },
    ],
    behavior: (rand) => {
      // during the antibiotic course very adherent ≈95% (salience effect),
      // PPI overall steady
      const r = rand();
      if (r < 0.85) {
        return rand() < 0.2
          ? { status: "delayed", delayMin: 35 + Math.floor(rand() * 30) }
          : { status: "taken", delayMin: -5 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.05) return { status: "skipped", delayMin: 10 + Math.floor(rand() * 25), skipReason: "forgot" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "rami",
    seed: 1111,
    name: "Rami Qasim",
    email: "rami@medsync.ai",
    lang: "en",
    arm: "control",
    profile: { age: 38, gender: "male", height: 178, weight: 86, bloodGroup: "B+", conditions: ["GERD", "Irritable bowel syndrome"], allergies: [] },
    meds: [
      {
        pillName: "Omeprazole",
        pillDescription: "Proton pump inhibitor",
        dosageAmount: "20mg",
        frequency: "Once before breakfast",
        slots: ["06:45"],
        originalInstructions: "Take 30 minutes before breakfast for best effect.",
        doctorName: "Dr. Hanan Aziz",
      },
      {
        pillName: "Mebeverine",
        pillDescription: "Antispasmodic",
        dosageAmount: "135mg",
        frequency: "Twice a day",
        slots: ["08:00", "20:00"],
        originalInstructions: "Take 20 minutes before meals.",
        doctorName: "Dr. Hanan Aziz",
      },
    ],
    behavior: (rand) => {
      // ≈88% confirmed but CHRONICALLY delayed 40-70 min (delay-consistency signal)
      const r = rand();
      if (r < 0.88) {
        return rand() < 0.8
          ? { status: "delayed", delayMin: 40 + Math.floor(rand() * 30) }
          : { status: "taken", delayMin: 0 + Math.floor(rand() * 25) };
      }
      if (rand() < 0.05) return { status: "skipped", delayMin: 10 + Math.floor(rand() * 20), skipReason: "not_needed" };
      return { status: "missed", delayMin: 0 };
    },
  },
  {
    key: "dalia",
    seed: 1212,
    name: "Dalia Shaheen",
    email: "dalia@medsync.ai",
    lang: "ar",
    arm: "smart",
    profile: { age: 44, gender: "female", height: 160, weight: 63, bloodGroup: "A-", conditions: ["Rheumatoid arthritis"], allergies: ["Iodine contrast"] },
    meds: [
      {
        pillName: "Methotrexate",
        pillDescription: "DMARD (weekly)",
        dosageAmount: "15mg",
        frequency: "Once weekly",
        slots: ["09:00"],
        days: ["Monday"], // weekly dosing — sparse-dose diversity
        originalInstructions: "Take once weekly on the same day; avoid alcohol.",
        translatedAr: "تناوليه مرة واحدة أسبوعياً في اليوم نفسه؛ تجنبي الكحول.",
        doctorName: "Dr. Sireen Sabella",
      },
      {
        pillName: "Naproxen",
        pillDescription: "NSAID",
        dosageAmount: "500mg",
        frequency: "Twice a day",
        slots: ["08:00", "20:00"],
        originalInstructions: "Take with food to protect the stomach.",
        translatedAr: "تناوليه مع الطعام لحماية المعدة.",
        doctorName: "Dr. Sireen Sabella",
      },
      {
        pillName: "Folic acid",
        pillDescription: "Vitamin B9 supplement (methotrexate co-therapy)",
        dosageAmount: "1mg",
        frequency: "Once a day",
        slots: ["09:00"],
        originalInstructions: "Take daily except methotrexate day unless directed.",
        translatedAr: "تناوليه يومياً عدا يوم الميثوتريكسات إلا بتعليمات طبية.",
        doctorName: "Dr. Sireen Sabella",
      },
    ],
    behavior: (rand, { hour, slot }) => {
      // weekly methotrexate near-perfect 0.97; daily med ≈70% with morning
      // stiffness pushing morning delays long (65-110 min)
      const isWeekly = slot === "09:00";
      const confirm = isWeekly ? 0.97 : 0.7;
      const r = rand();
      if (r < confirm) {
        const longDelay = !isWeekly && hour < 10 && rand() < 0.55;
        return longDelay || rand() < 0.2
          ? { status: "delayed", delayMin: longDelay ? 65 + Math.floor(rand() * 45) : 35 + Math.floor(rand() * 25) }
          : { status: "taken", delayMin: 0 + Math.floor(rand() * 20) };
      }
      if (!isWeekly && rand() < 0.07) return { status: "skipped", delayMin: 15 + Math.floor(rand() * 30), skipReason: "pain" };
      return { status: "missed", delayMin: 0 };
    },
  },
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
    data: { userId: user.id, arm: p.arm, reason: "cohort-seed-2" },
  });

  // 4. history — iterate days from oldest to today
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const adherenceByMed = new Map<string, { date: string; time: string; status: string; takenAt: string | null }[]>();

  for (const med of p.meds) {
    const activeDays = med.days ?? DAY_NAMES;
    const winFrom = med.window?.[0] ?? 0;
    const winTo = med.window?.[1] ?? HISTORICAL_DAYS;
    // course window → medication start/end dates reflect it
    const startDate = new Date(today.getTime() - (HISTORICAL_DAYS - winFrom) * 24 * 3600 * 1000);
    const endDate = med.window ? new Date(today.getTime() - (HISTORICAL_DAYS - winTo - 1) * 24 * 3600 * 1000) : null;

    const medication = await db.medication.create({
      data: {
        userId: user.id,
        pillName: med.pillName,
        pillDescription: med.pillDescription,
        dosageAmount: med.dosageAmount,
        frequency: med.frequency,
        dosageDays: JSON.stringify(activeDays),
        dosageTimes: JSON.stringify(
          med.slots.map((time) => ({ time, remindBefore: "15m", remindAfter: "30m", status: "pending", takenAt: null }))
        ),
        startDate,
        endDate,
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
      const dayName = DAY_NAMES[weekday];
      const histIndex = HISTORICAL_DAYS - dayIndex; // 0 (oldest) → 30 (today)

      // weekly dosing: skip days the med is not scheduled
      if (!activeDays.includes(dayName)) continue;
      // course window: skip days outside [winFrom, winTo]
      if (histIndex < winFrom || histIndex > winTo) continue;

      for (const slot of med.slots) {
        const scheduledAt = atLocalTime(day, slot);
        const hour = scheduledAt.getHours();

        if (isToday && scheduledAt.getTime() > now.getTime()) continue; // future slot today → pending (materializer handles)

        const out: Outcome = isToday && scheduledAt.getTime() > now.getTime() - 2 * 3600 * 1000
          ? { status: "pending", delayMin: 0 } as unknown as Outcome // very recent slot stays pending (grace)
          : p.behavior(rand, { dayIndex: histIndex, hour, isWeekend, slot });

        if ((out as { status: string }).status === "pending") continue;

        const actualAt =
          out.status === "missed"
            ? null
            : new Date(scheduledAt.getTime() + out.delayMin * 60 * 1000);
        // signed delay (schema: actualAt − scheduledAt, positive = late) —
        // negative = taken early; verify-data.ts checks dm ≈ actualAt−scheduledAt
        const delayMinutes =
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
  console.log("Seeding MedSync AI cohort v2 (7 additional personas, 30 days each)…");

  const results = [];
  for (const p of personas) {
    const r = await seedPersona(p, now);
    results.push(r);
    console.log(`  seeded ${r.email} (arm=${r.arm}, future events materialized=${r.materialized})`);
  }

  // summary across the whole platform
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
  console.log("\nPLATFORM SUMMARY (all users)");
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
