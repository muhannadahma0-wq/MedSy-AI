import type { InteractionWarning } from "./types";

/** Curated, pharmacist-reviewed style drug list used for autocomplete (WP3 fallback table). */
export const DRUG_CATALOG: {
  name: string;
  nameAr: string;
  forms: string[];
  defaultDosage?: string;
}[] = [
  { name: "Metformin", nameAr: "ميتفورمين", forms: ["tablet"], defaultDosage: "500 mg" },
  { name: "Paracetamol (Acetaminophen)", nameAr: "باراسيتامول", forms: ["tablet", "syrup"], defaultDosage: "500 mg" },
  { name: "Ibuprofen", nameAr: "إيبوبروفين", forms: ["tablet"], defaultDosage: "400 mg" },
  { name: "Aspirin", nameAr: "أسبرين", forms: ["tablet"], defaultDosage: "81 mg" },
  { name: "Amoxicillin", nameAr: "أموكسيسيلين", forms: ["capsule", "syrup"], defaultDosage: "500 mg" },
  { name: "Omeprazole", nameAr: "أوميبرازول", forms: ["capsule"], defaultDosage: "20 mg" },
  { name: "Pantoprazole", nameAr: "بانتوبرازول", forms: ["tablet"], defaultDosage: "40 mg" },
  { name: "Atorvastatin", nameAr: "أتورفاستاتين", forms: ["tablet"], defaultDosage: "20 mg" },
  { name: "Lisinopril", nameAr: "ليزينوبريل", forms: ["tablet"], defaultDosage: "10 mg" },
  { name: "Amlodipine", nameAr: "أملوديبين", forms: ["tablet"], defaultDosage: "5 mg" },
  { name: "Metoprolol", nameAr: "ميتوبرولول", forms: ["tablet"], defaultDosage: "50 mg" },
  { name: "Warfarin", nameAr: "وارفارين", forms: ["tablet"], defaultDosage: "5 mg" },
  { name: "Levothyroxine", nameAr: "ليفوثيروكسين", forms: ["tablet"], defaultDosage: "50 mcg" },
  { name: "Insulin Glargine", nameAr: "إنسولين غلارجين", forms: ["injection"] },
  { name: "Salbutamol", nameAr: "سالبوتامول", forms: ["inhaler"] },
  { name: "Loratadine", nameAr: "لوراتادين", forms: ["tablet"], defaultDosage: "10 mg" },
  { name: "Metoclopramide", nameAr: "ميتوكلوبراميد", forms: ["tablet"], defaultDosage: "10 mg" },
  { name: "Losartan", nameAr: "لوسارتان", forms: ["tablet"], defaultDosage: "50 mg" },
];

/**
 * Small curated interaction table (WP3 fallback).
 * Built from public drug-label knowledge; in the thesis this is replaced by
 * RxNorm normalization + a verified interaction source after license review.
 */
export const INTERACTION_TABLE: {
  a: string;
  b: string;
  severity: "major" | "moderate" | "minor";
  descriptionEn: string;
  descriptionAr: string;
}[] = [
  {
    a: "warfarin",
    b: "aspirin",
    severity: "major",
    descriptionEn:
      "Warfarin with aspirin significantly increases the risk of bleeding. This combination should only be used under close medical supervision.",
    descriptionAr:
      "الوارفارين مع الأسبرين يزيد خطر النزيف بشكل كبير. لا يُستخدم هذا المزيج إلا تحت إشراف طبي دقيق.",
  },
  {
    a: "warfarin",
    b: "ibuprofen",
    severity: "major",
    descriptionEn:
      "NSAIDs like ibuprofen combined with warfarin can cause serious gastrointestinal bleeding. Ask your doctor about safer pain relief options.",
    descriptionAr:
      "مضادات الالتهاب غير الستيرويدية مثل الإيبوبروفين مع الوارفارين قد تسبب نزيفاً هضمياً خطيراً. اسأل طبيبك عن مسكنات أكثر أماناً.",
  },
  {
    a: "aspirin",
    b: "ibuprofen",
    severity: "moderate",
    descriptionEn:
      "Ibuprofen can reduce the heart-protective effect of aspirin and add stomach irritation. Separate doses and consult your pharmacist.",
    descriptionAr:
      "الإيبوبروفين قد يقلل التأثير الوقائي للأسبرين على القلب ويزيد تهيّج المعدة. افصل بين الجرعتين واستشر صيدليك.",
  },
  {
    a: "lisinopril",
    b: "ibuprofen",
    severity: "moderate",
    descriptionEn:
      "NSAIDs can reduce the blood-pressure-lowering effect of ACE inhibitors like lisinopril and may affect kidney function.",
    descriptionAr:
      "مضادات الالتهاب قد تقلل تأثير خفض الضغط لمثبطات الإنزيم المحول مثل الليزينوبريل وقد تؤثر في وظائف الكلى.",
  },
  {
    a: "metformin",
    b: "insulin",
    severity: "moderate",
    descriptionEn:
      "Combining metformin with insulin increases the risk of hypoglycemia. Monitor your blood sugar as advised by your care team.",
    descriptionAr:
      "الجمع بين الميتفورمين والإنسولين يزيد خطر هبوط سكر الدم. راقب سكرك حسب تعليمات فريقك الطبي.",
  },
  {
    a: "levothyroxine",
    b: "omeprazole",
    severity: "minor",
    descriptionEn:
      "Stomach-acid reducers like omeprazole may slightly reduce levothyroxine absorption. Thyroid levels are usually monitored periodically.",
    descriptionAr:
      "خافضات حموضة المعدة مثل الأوميبرازول قد تقلل امتصاص الليفوثيروكسين قليلاً. عادةً تُراقب مستويات الغدة الدرقية دورياً.",
  },
  {
    a: "amlodipine",
    b: "simvastatin",
    severity: "minor",
    descriptionEn:
      "Amlodipine can slightly increase statin levels. Doses are usually adjusted by the prescriber.",
    descriptionAr:
      "الأملوديبين قد يرفع مستوى الستاتين قليلاً. عادةً يعدّل الطبيب الجرعات وفقاً لذلك.",
  },
];

export function normalizeDrug(name: string): string {
  const lower = name.toLowerCase().trim();
  const alias: Record<string, string> = {
    acetaminophen: "paracetamol",
    "paracetamol (acetaminophen)": "paracetamol",
    advil: "ibuprofen",
    brufen: "ibuprofen",
    glucophage: "metformin",
    lantus: "insulin glargine",
    ventolin: "salbutamol",
  };
  return alias[lower] ?? lower;
}

export function findInteractions(drugNames: string[]): InteractionWarning[] {
  const normalized = drugNames.map(normalizeDrug);
  const warnings: InteractionWarning[] = [];
  for (const row of INTERACTION_TABLE) {
    const idxA = normalized.findIndex((n) => n.includes(row.a) || row.a.includes(n));
    const idxB = normalized.findIndex((n) => n.includes(row.b) || row.b.includes(n));
    if (idxA >= 0 && idxB >= 0 && idxA !== idxB) {
      warnings.push({
        drugA: drugNames[idxA],
        drugB: drugNames[idxB],
        severity: row.severity,
        descriptionEn: row.descriptionEn,
        descriptionAr: row.descriptionAr,
      });
    }
  }
  // de-duplicate by pair
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = [normalizeDrug(w.drugA), normalizeDrug(w.drugB)].sort().join("+");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Emergency / red-flag keyword detection (WP3 guardrail). Multilingual AR+EN. */
const EMERGENCY_PATTERNS = [
  // English
  "chest pain",
  "can't breathe",
  "cannot breathe",
  "trouble breathing",
  "shortness of breath",
  "heart attack",
  "stroke",
  "unconscious",
  "severe bleeding",
  "bleeding a lot",
  "overdose",
  "poisoning",
  "suicidal",
  "kill myself",
  "seizure",
  "anaphylaxis",
  "emergency",
  // Arabic
  "ألم في الصدر",
  "الم في الصدر",
  "ضيق تنفس",
  "لا أستطيع التنفس",
  "لا استطيع التنفس",
  "صعوبة في التنفس",
  "جلطة",
  "سكتة قلبية",
  "نوبة قلبية",
  "فقدان الوعي",
  "نزيف شديد",
  "جرعة زائدة",
  "تسمم",
  "انتحار",
  "أنتحر",
  "اختلاج",
  "تشنجات",
  "حساسية شديدة",
  "طارئ",
  "طوارئ",
];

export function detectEmergency(text: string): boolean {
  const lower = text.toLowerCase();
  return EMERGENCY_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
