/**
 * Demo seed — creates a verified demo account with medications, 14 days of
 * adherence history, a health profile and an analyzed sample report so every
 * MedSync AI screen (Dashboard, Analytics, Reports, ReportChat) has data.
 *
 * Run: bun scripts/seed-demo.ts
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/server/password";
import readabilityChecker from "../src/lib/server/readability";

const db = new PrismaClient();

// Deterministic PRNG so the demo data is stable between runs
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

const DEMO_EMAIL = "demo@medsync.ai";
const DEMO_PASSWORD = "demo1234";

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const SAMPLE_REPORT_TEXT = `
COMPLETE BLOOD COUNT (CBC)
Patient: Demo User   Date: 2025-01-10

Test                  Result      Reference Range
Hemoglobin            10.8 g/dL   13.0 - 17.0 (LOW)
Hematocrit            33.5 %      41.0 - 53.0 (LOW)
RBC Count             4.1 x10^6/uL 4.5 - 5.9 (LOW)
WBC Count             7.2 x10^3/uL 4.0 - 11.0
Platelets             245 x10^3/uL 150 - 450
MCV                   82 fL        80 - 100
MCH                   26 pg        27 - 33 (LOW)
Ferritin              12 ng/mL     30 - 400 (LOW)
Vitamin B12           290 pg/mL    200 - 900

Impression: Mild microcytic anemia consistent with iron deficiency.
Recommendation: Iron supplementation, dietary review, repeat CBC in 8 weeks.
`;

const SAMPLE_ANALYSIS = `The report shows mild microcytic anemia: hemoglobin 10.8 g/dL, hematocrit 33.5%, and low ferritin (12 ng/mL) indicate iron deficiency. Platelets and white cells are within normal ranges, so infection or marrow disorder is unlikely. Recommendation: start iron supplementation as prescribed, include iron-rich foods (lean meat, legumes, leafy greens) with vitamin C to aid absorption, and repeat the CBC and ferritin in 8 weeks. Alert: if fatigue, pallor, or shortness of breath worsen, follow up earlier.`;

interface Dose {
  time: string;
  remindBefore: string;
  remindAfter: string;
  status: "pending" | "taken" | "missed" | "delayed";
  takenAt: string | null;
}

function makeDoses(times: string[]): Dose[] {
  return times.map((time) => ({
    time,
    remindBefore: "15m",
    remindAfter: "30m",
    status: "pending",
    takenAt: null,
  }));
}

async function main() {
  console.log("Seeding MedSync AI demo data…");

  // Clean slate for the demo account
  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await db.medication.deleteMany({ where: { userId: existing.id } });
    await db.report.deleteMany({ where: { userId: existing.id } });
    await db.conversation.deleteMany({ where: { user: existing.id } });
    await db.dailyNotification.deleteMany({ where: { userId: existing.id } });
    await db.healthProfile.deleteMany({ where: { user: existing.id } });
    await db.user.delete({ where: { id: existing.id } });
  }

  const user = await db.user.create({
    data: {
      name: "Demo User",
      email: DEMO_EMAIL,
      password: hashPassword(DEMO_PASSWORD),
      isVerified: true,
      preferredLanguage: "en",
      backupCodes: "[]",
    },
  });
  console.log("Demo user:", user.email, "password:", DEMO_PASSWORD);

  await db.healthProfile.create({
    data: {
      user: user.id,
      age: 34,
      gender: "female",
      height: 168,
      weight: 62,
      bloodGroup: "O+",
      medicalConditions: JSON.stringify(["Iron deficiency anemia", "Seasonal allergies"]),
      allergies: JSON.stringify(["Penicillin"]),
      medications: JSON.stringify(["Ferrous sulfate", "Cetirizine"]),
      emergencyContact: JSON.stringify({ name: "Emergency Contact", phone: "+970 599 000 000" }),
    },
  });

  const meds: Array<{
    pillName: string;
    pillDescription: string;
    dosageAmount: string;
    frequency: string;
    times: string[];
    days: string[];
  }> = [
    {
      pillName: "Ferrous Sulfate",
      pillDescription: "Take one tablet in the morning on an empty stomach with orange juice. Avoid tea or coffee within one hour.",
      dosageAmount: "325 mg",
      frequency: "1 time a day",
      times: ["08:00"],
      days: ALL_DAYS,
    },
    {
      pillName: "Cetirizine",
      pillDescription: "Take one tablet in the evening for seasonal allergies. May cause mild drowsiness.",
      dosageAmount: "10 mg",
      frequency: "1 time a day",
      times: ["20:00"],
      days: ALL_DAYS,
    },
    {
      pillName: "Vitamin D3",
      pillDescription: "Take one softgel with the largest meal of the day to improve absorption.",
      dosageAmount: "2000 IU",
      frequency: "1 time a day",
      times: ["13:30"],
      days: ["Monday", "Wednesday", "Friday"],
    },
  ];

  const now = new Date();
  const todayDay = now.toLocaleString("en-US", { weekday: "long" });

  for (const med of meds) {
    // Build today's dose list; earlier doses already "taken"
    const doses: Dose[] = makeDoses(med.times).map((d) => {
      const [h, m] = d.time.split(":").map(Number);
      const doseTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      if (doseTime < now && rand() > 0.25) {
        return { ...d, status: "taken" as const, takenAt: doseTime.toISOString() };
      }
      return d;
    });

    // 14 days of adherence history (~85% taken, some delayed/missed)
    const history: Array<{ date: string; time: string; status: "taken" | "missed" | "delayed"; takenAt: string | null }> = [];
    for (let dayOffset = 14; dayOffset >= 1; dayOffset--) {
      const day = new Date(now);
      day.setDate(day.getDate() - dayOffset);
      const dayName = day.toLocaleString("en-US", { weekday: "long" });
      if (!med.days.includes(dayName)) continue;

      for (const time of med.times) {
        const [h, m] = time.split(":").map(Number);
        const eventDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        const roll = rand();
        let status: "taken" | "missed" | "delayed" = "taken";
        if (roll > 0.94) status = "missed";
        else if (roll > 0.86) status = "delayed";
        history.push({
          date: eventDate.toISOString(),
          time,
          status,
          takenAt: status === "taken" ? eventDate.toISOString() : null,
        });
      }
    }

    // Guarantee a clean 6-day streak at the end (all taken)
    for (let dayOffset = 6; dayOffset >= 1; dayOffset--) {
      const day = new Date(now);
      day.setDate(day.getDate() - dayOffset);
      const dayName = day.toLocaleString("en-US", { weekday: "long" });
      if (!med.days.includes(dayName)) continue;
      for (const time of med.times) {
        const [h, m] = time.split(":").map(Number);
        const eventDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        const existingIdx = history.findIndex(
          (hh) => hh.date.slice(0, 10) === eventDate.toISOString().slice(0, 10) && hh.time === time
        );
        const record = {
          date: eventDate.toISOString(),
          time,
          status: "taken" as const,
          takenAt: eventDate.toISOString(),
        };
        if (existingIdx >= 0) history[existingIdx] = record;
        else history.push(record);
      }
    }

    await db.medication.create({
      data: {
        userId: user.id,
        pillName: med.pillName,
        pillDescription: med.pillDescription,
        originalInstructions: med.pillDescription,
        translatedEs: med.pillDescription, // translated lazily by the API when needed
        translatedHi: med.pillDescription,
        dosageDays: JSON.stringify(med.days),
        dosageTimes: JSON.stringify(doses),
        dosageAmount: med.dosageAmount,
        frequency: med.frequency,
        startDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
        adherenceHistory: JSON.stringify(history),
      },
    });
  }

  // Sample analyzed report
  const readability = readabilityChecker.analyzeReadability(SAMPLE_ANALYSIS, "en");
  await db.report.create({
    data: {
      userId: user.id,
      filename: "cbc-report-sample.pdf",
      reportText: SAMPLE_REPORT_TEXT.trim(),
      analysis: SAMPLE_ANALYSIS,
      translatedAnalysis: "{}",
      originalLanguage: "en",
      readabilityScore: JSON.stringify(readability),
    },
  });

  // Today's stored notifications (matching the scheduler's persistence shape)
  const todayDate = now.toISOString().split("T")[0];
  await db.dailyNotification.create({
    data: {
      userId: user.id,
      date: todayDate,
      dayName: todayDay,
      notifications: JSON.stringify([
        {
          title: "💊 It's medicine time",
          message: "Time for Ferrous Sulfate at 8:00 AM. Your health journey matters! 🌱",
          type: "onTime",
          medicineName: "Ferrous Sulfate",
          time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0).toISOString(),
        },
        {
          title: "🔔 Test Notification",
          message: "This is a dummy test alert!",
          type: "test",
          time: now.toISOString(),
        },
      ]),
    },
  });

  console.log("Seed complete ✔");
  console.log(`Login with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
