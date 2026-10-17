import { NextResponse } from "next/server";
import type { Medication } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReportAnalysis } from "@/lib/types";
import { SAMPLE_REPORT } from "@/lib/sample-report";

/** Deterministic RNG so the demo profile is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_REPORT_TITLE = SAMPLE_REPORT.title;
const SAMPLE_REPORT_CONTENT = SAMPLE_REPORT.content;

const SAMPLE_ANALYSIS: ReportAnalysis = {
  summary:
    "يُظهر تقرير تعداد الدم الكامل فقر دم بعوز الحديد: الهيموغلوبين 10.8 g/dL (أقل من المعدل الطبيعي) مع انخفاض الهيماتوكريت وحجم الكريات والحديد المصلي والفيريتين. كريات الدم البيضاء والصفيحات ضمن المعدل الطبيعي، ما يجعل المشكلة مركّزة في خط كريات الدم الحمراء. التقرير ينصح بمتابعة الطبيب المعالج لتحديد السبب وخطة العلاج.",
  keyFindings: [
    {
      finding: "الهيموغلوبين منخفض (10.8 g/dL) والطبيعي يبدأ من 13.0",
      source: "الهيموغلوبين (Hemoglobin): 10.8 g/dL [الطبيعي: 13.0-17.0] — منخفض",
    },
    {
      finding: "مخزون الحديد منخفض جداً: الفيريتين 18 ng/mL فقط",
      source: "الفيريتين (Ferritin): 18 ng/mL [الطبيعي: 30-300] — منخفض",
    },
    {
      finding: "حجم الكرية المتوسط صغير (MCV 76 fL) ما يوافق فقر دم صغير الكريات",
      source: "حجم الكرية المتوسط (MCV): 76 fL [الطبيعي: 80-100] — منخفض",
    },
    {
      finding: "كريات الدم البيضاء والصفيحات طبيعية — لا مؤشر على التهاب أو اضطراب تخثر",
      source: "عدد كريات الدم البيضاء (WBC): 6.4 ×10^9/L [الطبيعي: 4.0-11.0] — طبيعي",
    },
  ],
  warnings: [
    "Hemoglobin 10.8 g/dL — أقل من الحد الطبيعي (13.0)",
    "Ferritin 18 ng/mL — أقل بكثير من الحد الطبيعي (30)",
    "Hematocrit 33.5% — أقل من الحد الطبيعي (40)",
    "MCV 76 fL — أقل من الحد الطبيعي (80)",
    "Serum Iron 55 µg/dL — أقل من الحد الطبيعي (65)",
  ],
  readability: {
    level: "medium",
    note: "نص مختبري يتضمن أرقاماً ومصطلحات طبية، لكن الجدول وترتيبه يجعلان قراءته ممكنة للمريض مع شرح مبسط.",
  },
};

const DEMO_MEDS = [
  {
    name: "Metformin",
    nameAr: "ميتفورمين",
    dosage: "500 mg",
    form: "tablet",
    times: ["08:00", "20:00"],
    days: [0, 1, 2, 3, 4, 5, 6],
    instructions: "Take with food to reduce stomach upset. Avoid excessive alcohol.",
    instructionsAr: "يُؤخذ مع الطعام لتقليل اضطراب المعدة. تجنّب الإفراط في الكحول.",
    color: "teal",
  },
  {
    name: "Lisinopril",
    nameAr: "ليزينوبريل",
    dosage: "10 mg",
    form: "tablet",
    times: ["09:00"],
    days: [0, 1, 2, 3, 4, 5, 6],
    instructions: "Take in the morning at the same time every day.",
    instructionsAr: "يُؤخذ صباحاً في نفس التوقيت كل يوم.",
    color: "rose",
  },
  {
    name: "Warfarin",
    nameAr: "وارفارين",
    dosage: "5 mg",
    form: "tablet",
    times: ["18:00"],
    days: [0, 1, 2, 3, 4, 5, 6],
    instructions: "Take in the evening. Keep vitamin K intake consistent and attend INR checks.",
    instructionsAr: "يُؤخذ مساءً. حافظ على ثبات تناول فيتامين K وحضر فحوصات INR بانتظام.",
    color: "amber",
  },
  {
    name: "Aspirin",
    nameAr: "أسبرين",
    dosage: "81 mg",
    form: "tablet",
    times: ["09:30"],
    days: [0, 2, 4, 6],
    instructions: "Low-dose aspirin for heart protection. Watch for unusual bruising or bleeding.",
    instructionsAr: "أسبرين بجرعة منخفضة لحماية القلب. راقب ظهور كدمات أو نزيف غير معتاد.",
    color: "emerald",
  },
];

export async function POST() {
  const rng = mulberry32(20250112);

  // wipe
  await db.doseEvent.deleteMany();
  await db.medication.deleteMany();
  await db.report.deleteMany();

  const meds: Medication[] = [];
  for (const m of DEMO_MEDS) {
    meds.push(
      await db.medication.create({
        data: {
          ...m,
          times: JSON.stringify(m.times),
          days: JSON.stringify(m.days),
          startDate: new Date(Date.now() - 32 * 24 * 3600 * 1000),
        },
      })
    );
  }

  // ---- 30 days of dose history with behavioral patterns (WP2 data foundation) ----
  const now = new Date();
  const nowStart = new Date(now);
  nowStart.setHours(0, 0, 0, 0);

  for (let dayOffset = 30; dayOffset >= 1; dayOffset--) {
    const day = new Date(nowStart);
    day.setDate(day.getDate() - dayOffset);
    const weekday = day.getDay();
    const isWeekend = weekday === 5 || weekday === 6;

    for (const med of meds) {
      const days = JSON.parse(med.days) as number[];
      if (!days.includes(weekday)) continue;
      for (const hhmm of JSON.parse(med.times) as string[]) {
        const [h, min] = hhmm.split(":").map(Number);
        const scheduledAt = new Date(day);
        scheduledAt.setHours(h, min, 0, 0);

        // adherence personas: evening + weekend doses are missed more,
        // but the last few days are clean so the streak is meaningful
        let takenProb = h >= 18 ? 0.85 : 0.95;
        if (isWeekend) takenProb -= 0.1;
        if (dayOffset > 7 && dayOffset <= 14) takenProb -= 0.05;
        if (dayOffset <= 5) takenProb = 1; // recent clean days → live streak
        else if (dayOffset <= 7) takenProb = 0.8; // one likely miss just before the streak

        const roll = rng();
        let status: string;
        let respondedAt: Date | null = null;
        if (roll < takenProb) {
          status = "taken";
          const delayMin = Math.floor(rng() * 50) - 15; // -15..+35 min around schedule
          respondedAt = new Date(scheduledAt.getTime() + delayMin * 60 * 1000);
        } else if (roll < takenProb + 0.06) {
          status = "snoozed";
          respondedAt = new Date(scheduledAt.getTime() + 15 * 60 * 1000);
        } else if (roll < takenProb + 0.1) {
          status = "skipped";
          respondedAt = new Date(scheduledAt.getTime() + 20 * 60 * 1000);
        } else {
          status = "missed";
        }

        await db.doseEvent.create({
          data: { medicationId: med.id, scheduledAt, status, respondedAt },
        });
      }
    }
  }

  // ---- today: past morning doses mostly taken, rest pending ----
  for (const med of meds) {
    const days = JSON.parse(med.days) as number[];
    if (!days.includes(nowStart.getDay())) continue;
    for (const hhmm of JSON.parse(med.times) as string[]) {
      const [h, min] = hhmm.split(":").map(Number);
      const scheduledAt = new Date(nowStart);
      scheduledAt.setHours(h, min, 0, 0);
      if (scheduledAt < new Date(now.getTime() - 60 * 60 * 1000)) {
        // past doses today are all taken → keeps the streak alive;
        // historical misses 6-7 days ago still feed the risk heuristic
        await db.doseEvent.create({
          data: {
            medicationId: med.id,
            scheduledAt,
            status: "taken",
            respondedAt: new Date(scheduledAt.getTime() + 10 * 60 * 1000),
          },
        });
      } else {
        await db.doseEvent.create({
          data: { medicationId: med.id, scheduledAt, status: "pending" },
        });
      }
    }
  }

  // ---- sample report with pre-baked analysis ----
  await db.report.create({
    data: {
      title: SAMPLE_REPORT_TITLE,
      content: SAMPLE_REPORT_CONTENT,
      analysis: JSON.stringify(SAMPLE_ANALYSIS),
    },
  });

  return NextResponse.json({ ok: true, medications: meds.length });
}
