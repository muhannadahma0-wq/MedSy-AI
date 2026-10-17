/**
 * Medical terminology dictionary used to preserve specialized terms across
 * translation. Bilingual build: English → Arabic (Modern Standard Arabic).
 *
 * v5 review item 49 — STRUCTURED, REVIEWABLE GLOSSARY. Every entry now
 * carries:
 *   - ar        : the Arabic (MSA) rendering — REQUIRED, so existing
 *                 consumers (translation.ts placeholder pipeline,
 *                 getMedicalTermTranslation / getMedicalTermsDictionary)
 *                 keep working unchanged.
 *   - context   : when the term is used + register guidance for reviewers.
 *   - approved  : HONESTY FLAG. `false` (the default) = awaiting qualified
 *                 human medical review. `true` is set ONLY on pure
 *                 transliterations (e.g. أسبرين for aspirin) whose Arabic
 *                 form is the standard, uncontroversial pharmacy rendering.
 *   - reviewer  : who signed off. "pending-qualified-reviewer" means NO
 *                 qualified human has reviewed this entry yet — no approvals
 *                 are faked. A licensed physician / pharmacist / certified
 *                 medical translator flips this to a real name after review.
 *
 * The reviewable rendering of this dictionary lives in docs/GLOSSARY.md,
 * regenerated with `bun run scripts/gen-glossary.ts` (manual step).
 */

export interface MedicalTermEntry {
  /** Arabic (MSA) rendering — required so existing destructuring keeps working. */
  ar: string;
  /** When/where the term is used + register guidance (review aid). */
  context?: string;
  /** false by default — awaiting qualified human medical review (v5 item 49). */
  approved?: boolean;
  /** Who signed off; "pending-qualified-reviewer" until a real review happens. */
  reviewer?: string;
}

const PENDING_REVIEW = "pending-qualified-reviewer";

export const MEDICAL_TERMS: Record<string, MedicalTermEntry> = {
  // ── Common medications ────────────────────────────────────────────────────
  // Pure INN transliterations → approved: true (uncontroversial pharmacy
  // renderings); a qualified reviewer still hasn't signed off (reviewer field).
  acetaminophen: {
    ar: "أسيتامينوفين (باراسيتامول)",
    context: "Pain/fever reliever. Keep the parenthetical باراسيتامول — the name patients actually see in Arab pharmacies.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  ibuprofen: {
    ar: "إيبوبروفين",
    context: "NSAID for pain/inflammation; standard INN transliteration.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  aspirin: {
    ar: "أسبرين",
    context: "Antiplatelet/analgesic; universally known transliteration.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  metformin: {
    ar: "ميتفورمين",
    context: "First-line type-2 diabetes medication (the app's demo regimens include it).",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  lisinopril: {
    ar: "ليزينوبريل",
    context: "ACE inhibitor for hypertension.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  atorvastatin: {
    ar: "أتورفاستاتين",
    context: "Statin for cholesterol lowering.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  omeprazole: {
    ar: "أوميبرازول",
    context: "Proton-pump inhibitor for acid reflux/ulcers.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  amoxicillin: {
    ar: "أموكسيسيلين",
    context: "Common antibiotic — never recommend without a prescription.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  sertraline: {
    ar: "سيرترالين",
    context: "SSRI antidepressant; use a sensitive, non-stigmatizing register.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  insulin: {
    ar: "الأنسولين",
    context: "Blood-sugar hormone/therapy; the definite-article form الأنسولين is standard.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },

  // ── Chronic-disease medications (v5 item 49 additions) ────────────────────
  amlodipine: {
    ar: "أملوديبين",
    context: "Calcium-channel blocker for hypertension/angina.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  losartan: {
    ar: "لوسارتان",
    context: "ARB (angiotensin-receptor blocker) for hypertension.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  simvastatin: {
    ar: "سيمفاستاتين",
    context: "Statin for cholesterol; often paired with lifestyle advice.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  rosuvastatin: {
    ar: "روسوفاستاتين",
    context: "Statin for cholesterol, high-intensity regimens.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  metoprolol: {
    ar: "ميتوبرولول",
    context: "Beta blocker for heart rate/blood pressure/angina.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  hydrochlorothiazide: {
    ar: "هيدروكلوروثيازيد",
    context: "Thiazide diuretic for hypertension/edema.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  furosemide: {
    ar: "فوروسيميد",
    context: "Loop diuretic for edema/heart failure.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  warfarin: {
    ar: "وارفارين",
    context: "Anticoagulant; many food/drug interactions — always defer dosing questions to the clinician.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  clopidogrel: {
    ar: "كلوبيدوغريل",
    context: "Antiplatelet used after stents/stroke.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  pantoprazole: {
    ar: "بانتوبرازول",
    context: "Proton-pump inhibitor, alternative to omeprazole.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  salbutamol: {
    ar: "سالبوتامول",
    context: "Inhaled bronchodilator for asthma relief (albuterol in US naming).",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  levothyroxine: {
    ar: "ليفوتيروكسين",
    context: "Thyroid-hormone replacement; morning fasting administration matters.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  prednisone: {
    ar: "بريدنيزون",
    context: "Corticosteroid; never advise stopping abruptly — tapering is clinical.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },
  gabapentin: {
    ar: "غابابنتين",
    context: "Nerve-pain/anticonvulsant medication.",
    approved: true,
    reviewer: PENDING_REVIEW,
  },

  // ── Conditions and diseases ───────────────────────────────────────────────
  diabetes: {
    ar: "داء السكري",
    context: "Chronic-disease education; formal MSA داء السكري in explanations rather than the colloquial السكري.",
  },
  hypertension: {
    ar: "ارتفاع ضغط الدم",
    context: "Chronic-disease education and lab-review chats; formal register.",
  },
  arthritis: {
    ar: "التهاب المفاصل",
    context: "Joint inflammation; general umbrella term — specify the type when known.",
  },
  asthma: {
    ar: "الربو",
    context: "Chronic respiratory condition; inhaler technique is a common question.",
  },
  pneumonia: {
    ar: "التهاب الرئة",
    context: "Acute lung infection — flag as needing medical attention.",
  },
  "heart disease": {
    ar: "أمراض القلب",
    context: "Cardiovascular umbrella term.",
  },
  depression: {
    ar: "الاكتئاب",
    context: "Mental-health term; sensitive, non-judgmental register, never dismissive.",
  },
  anxiety: {
    ar: "القلق",
    context: "Mental-health term; distinguish everyday worry from clinical disorder.",
  },
  infection: {
    ar: "العدوى",
    context: "General pathological term.",
  },
  fever: {
    ar: "الحمى",
    context: "Common symptom in triage chats.",
  },
  "chronic disease": {
    ar: "مرض مزمن",
    context: "Core user population of the platform; long-term-management framing.",
  },

  // ── Medical procedures and tests ──────────────────────────────────────────
  "blood pressure": {
    ar: "ضغط الدم",
    context: "Vital sign; chronic-disease monitoring conversations.",
  },
  "blood sugar": {
    ar: "سكر الدم",
    context: "Diabetes self-monitoring term; keep distinct from HbA1c (long-term marker).",
  },
  "blood test": {
    ar: "تحليل الدم",
    context: "General lab-work term.",
  },
  "MRI scan": {
    ar: "فحص الرنين المغناطيسي",
    context: "Imaging study; often anxiety-laden — neutral, calm register.",
  },
  "CT scan": {
    ar: "فحص التصوير المقطعي",
    context: "Imaging study.",
  },
  "X-ray": {
    ar: "الأشعة السينية",
    context: "Imaging study.",
  },
  biopsy: {
    ar: "الخزعة",
    context: "Tissue-sampling procedure; can cause anxiety — neutral register.",
  },
  vaccination: {
    ar: "التطعيم",
    context: "Preventive-care term.",
  },
  surgery: {
    ar: "الجراحة",
    context: "Procedure umbrella term; pre/post-operative questions.",
  },
  "physical therapy": {
    ar: "العلاج الطبيعي",
    context: "Rehabilitation/referral term.",
  },

  // ── Dosage and administration ─────────────────────────────────────────────
  tablet: {
    ar: "قرص",
    context: "Dosage form on prescriptions and reminders.",
  },
  capsule: {
    ar: "كبسولة",
    context: "Dosage form on prescriptions and reminders.",
  },
  injection: {
    ar: "حقنة",
    context: "Administration route.",
  },
  "oral medication": {
    ar: "دواء عن طريق الفم",
    context: "Administration route.",
  },
  "topical application": {
    ar: "تطبيق موضعي",
    context: "Administration route (skin); note the Arabic is a calque — verify with reviewer.",
  },
  dosage: {
    ar: "الجرعة",
    context: "Amount/frequency instructions on prescriptions; the app's most frequent instruction term.",
  },
  dose: {
    ar: "جرعة",
    context: "Single dose; reminder-engine and adherence contexts (indefinite form vs. dosage).",
  },
  frequency: {
    ar: "عدد المرات",
    context: "How often a dose is taken.",
  },
  "every morning": {
    ar: "كل صباح",
    context: "Timing instruction on prescriptions.",
  },
  "every evening": {
    ar: "كل مساء",
    context: "Timing instruction on prescriptions.",
  },
  "twice daily": {
    ar: "مرتين يومياً",
    context: "Frequency instruction on prescriptions.",
  },
  "three times daily": {
    ar: "ثلاث مرات يومياً",
    context: "Frequency instruction on prescriptions.",
  },
  "once daily": {
    ar: "مرة واحدة يومياً",
    context: "Frequency instruction on prescriptions.",
  },
  "after meals": {
    ar: "بعد الوجبات",
    context: "Food-timing instruction.",
  },
  "before meals": {
    ar: "قبل الوجبات",
    context: "Food-timing instruction.",
  },
  "with food": {
    ar: "مع الطعام",
    context: "Food-timing instruction (reduces stomach upset).",
  },
  "without food": {
    ar: "على معدة فارغة",
    context: "Food-timing instruction (fasting absorption).",
  },
  "as needed": {
    ar: "عند الحاجة",
    context: "PRN instruction; advise against exceeding daily maximums.",
  },
  "missed dose": {
    ar: "جرعة فائتة",
    context: "Adherence outcome term (reminder engine + notification texts).",
  },
  "medication adherence": {
    ar: "الالتزام الدوائي",
    context: "Core platform/research concept; formal research register.",
  },
  "over-the-counter": {
    ar: "يُصرف بدون وصفة طبية",
    context: "OTC classification; pharmacist-advice framing.",
  },

  // ── Side effects and symptoms ─────────────────────────────────────────────
  "side effect": {
    ar: "أثر جانبي",
    context: "Adverse-reaction reporting; persistent/severe effects → clinician.",
  },
  nausea: {
    ar: "الغثيان",
    context: "Common symptom and medication side effect.",
  },
  dizziness: {
    ar: "الدوخة",
    context: "Common symptom; safety concern for falls/driving.",
  },
  headache: {
    ar: "الصداع",
    context: "Common symptom.",
  },
  "stomach pain": {
    ar: "ألم المعدة",
    context: "Symptom; escalate when severe or persistent.",
  },
  "allergic reaction": {
    ar: "تفاعل تحسسي",
    context: "Safety-critical; severe forms (breathing difficulty) are an emergency.",
  },
  rash: {
    ar: "طفح جلدي",
    context: "Dermatological symptom; possible drug reaction — timing matters.",
  },
  palpitations: {
    ar: "خفقان القلب",
    context: "Cardiac symptom; ask about duration/triggers; red flag when paired with chest pain.",
  },
  "shortness of breath": {
    ar: "ضيق التنفس",
    context: "Red-flag symptom — urgent when sudden or severe.",
  },
  "chest pain": {
    ar: "ألم في الصدر",
    context: "Emergency red flag; NEVER triage down — direct to emergency services.",
  },
  fatigue: {
    ar: "التعب والإرهاق",
    context: "Non-specific symptom; common in chronic disease and as a medication effect.",
  },
  vomiting: {
    ar: "التقيؤ",
    context: "Symptom; dehydration risk for elderly users.",
  },
  diarrhea: {
    ar: "الإسهال",
    context: "Symptom; hydration guidance, medication-review question.",
  },
  constipation: {
    ar: "الإمساك",
    context: "Common GI symptom; classic opioid side effect.",
  },
  insomnia: {
    ar: "الأرق",
    context: "Sleep symptom; also a medication side effect.",
  },
  cough: {
    ar: "السعال",
    context: "Respiratory symptom; note dry vs productive when reported.",
  },
  "sore throat": {
    ar: "التهاب الحلق",
    context: "Symptom; specify duration and fever presence.",
  },
  "blurred vision": {
    ar: "تشوش الرؤية",
    context: "Symptom; can indicate blood-sugar swings — suggests a check.",
  },
  swelling: {
    ar: "التورّم",
    context: "Symptom/sign; note location and one-sidedness (edema vs other causes).",
  },

  // ── Laboratory terms (v5 item 49 additions) ───────────────────────────────
  hemoglobin: {
    ar: "الهيموغلوبين",
    context: "Anemia lab marker in uploaded report analysis.",
  },
  HbA1c: {
    ar: "السكر التراكمي (الهيموغلوبين السكري)",
    context: "3-month diabetes-control marker; keep both names — السكر التراكمي is what patients know.",
  },
  cholesterol: {
    ar: "الكوليسترول",
    context: "Cardiovascular lab marker; lifestyle + medication context.",
  },
  triglycerides: {
    ar: "الدهون الثلاثية",
    context: "Lipid-panel component.",
  },
  creatinine: {
    ar: "الكرياتينين",
    context: "Kidney-function marker; medication-dosing relevance.",
  },
  "white blood cells": {
    ar: "كريات الدم البيضاء",
    context: "Infection/inflammation marker.",
  },
  platelets: {
    ar: "الصفائح الدموية",
    context: "Clotting marker.",
  },
  "liver enzymes": {
    ar: "إنزيمات الكبد",
    context: "Liver-function panel (ALT/AST umbrella).",
  },

  // ── Medical advice ────────────────────────────────────────────────────────
  "consult doctor": {
    ar: "استشر الطبيب",
    context: "Standard professional-referral wording in agent answers.",
  },
  emergency: {
    ar: "حالة طارئة",
    context: "Escalation keyword — must ALWAYS render correctly; pairs with locale-aware emergency numbers.",
  },
  contraindication: {
    ar: "موانع الاستخدام",
    context: "Professional register; explain plainly in patient-facing text.",
  },
  interaction: {
    ar: "تفاعل دوائي",
    context: "Drug-interaction context (see drug-interactions.ts).",
  },
  refill: {
    ar: "إعادة صرف الوصفة",
    context: "Adherence/reminder context; running-out-of-medication nudges.",
  },
  prescription: {
    ar: "الوصفة الطبية",
    context: "Medication workflow term.",
  },

  // ── Units and measurements ────────────────────────────────────────────────
  milligrams: {
    ar: "ملليغرام",
    context: "Unit on prescriptions/lab results.",
  },
  mg: {
    ar: "ملغ",
    context: "Abbreviated unit on prescriptions.",
  },
  milliliters: {
    ar: "ملليلتر",
    context: "Liquid-medication unit.",
  },
  ml: {
    ar: "مل",
    context: "Abbreviated liquid unit.",
  },
  hours: {
    ar: "ساعات",
    context: "Time unit in instructions/reminders.",
  },
  days: {
    ar: "أيام",
    context: "Time unit in instructions/treatment courses.",
  },
  weeks: {
    ar: "أسابيع",
    context: "Time unit in follow-up guidance.",
  },
  months: {
    ar: "أشهر",
    context: "Time unit in chronic-disease management.",
  },
};

export function getMedicalTermTranslation(term: string, targetLanguage: string): string {
  const termLower = term.toLowerCase();
  const termData = MEDICAL_TERMS[termLower];
  if (!termData) return term;
  if (targetLanguage === "ar") return termData.ar || term;
  return term;
}

export function getMedicalTermsDictionary(targetLanguage: string): Record<string, string> {
  const dictionary: Record<string, string> = {};
  Object.entries(MEDICAL_TERMS).forEach(([engTerm, translations]) => {
    dictionary[engTerm] = translations[targetLanguage as "ar"] || engTerm;
  });
  return dictionary;
}
