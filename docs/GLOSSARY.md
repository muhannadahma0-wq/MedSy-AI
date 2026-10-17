# MedSync-AI — Arabic Medical Glossary (المسرد الطبي العربي)

> ⚠️ This file is GENERATED from `src/lib/server/medical-terminology.ts` by
> `bun run scripts/gen-glossary.ts` — do not edit it by hand. Edit the
> dictionary, then regenerate. Generation is manual; nothing updates this
> file automatically.

## Review workflow — how a term gets approved (v5 review item 49)

1. A **qualified human medical reviewer** (licensed physician, pharmacist, or
   certified medical translator) reviews a row below.
2. To sign off, set `approved: true` **and** `reviewer: "<real name,
   credential>"` on that entry in `src/lib/server/medical-terminology.ts`.
3. Regenerate this document: `bun run scripts/gen-glossary.ts`.
4. Commit both files together so the code and the document stay in sync.

### Honesty statement (لا تزكيات مُفبركة)

- `approved: true` is currently set **only on pure transliterations**
  (medication INNs such as أسبرين for aspirin) — Arabic renderings that are
  the standard, uncontroversial pharmacy forms.
- Even those entries carry `reviewer: "pending-qualified-reviewer"`:
  **no qualified human has signed off on any entry yet.** All other entries
  are `approved: false` and explicitly await qualified review.
- The `context` column documents when each term is used and register
  guidance — it is a review aid, not an approval.

سير العمل: يراجع مُراجعٌ طبي مؤهل الصفوف أدناه، ثم يضبط `approved: true`
مع `reviewer: "<الاسم والاعتماد>"` في `src/lib/server/medical-terminology.ts`
ويعيد توليد هذا الملف. لا يُعتبر أي مصطلح معتمداً فعلياً حتى تتم هذه المراجعة.

## Glossary (107 terms)

| English term | Arabic term (MSA) | Context | Approved | Reviewer |
|---|---|---|---|---|
| acetaminophen | أسيتامينوفين (باراسيتامول) | Pain/fever reliever. Keep the parenthetical باراسيتامول — the name patients actually see in Arab pharmacies. | ✅ yes (transliteration) | pending-qualified-reviewer |
| ibuprofen | إيبوبروفين | NSAID for pain/inflammation; standard INN transliteration. | ✅ yes (transliteration) | pending-qualified-reviewer |
| aspirin | أسبرين | Antiplatelet/analgesic; universally known transliteration. | ✅ yes (transliteration) | pending-qualified-reviewer |
| metformin | ميتفورمين | First-line type-2 diabetes medication (the app's demo regimens include it). | ✅ yes (transliteration) | pending-qualified-reviewer |
| lisinopril | ليزينوبريل | ACE inhibitor for hypertension. | ✅ yes (transliteration) | pending-qualified-reviewer |
| atorvastatin | أتورفاستاتين | Statin for cholesterol lowering. | ✅ yes (transliteration) | pending-qualified-reviewer |
| omeprazole | أوميبرازول | Proton-pump inhibitor for acid reflux/ulcers. | ✅ yes (transliteration) | pending-qualified-reviewer |
| amoxicillin | أموكسيسيلين | Common antibiotic — never recommend without a prescription. | ✅ yes (transliteration) | pending-qualified-reviewer |
| sertraline | سيرترالين | SSRI antidepressant; use a sensitive, non-stigmatizing register. | ✅ yes (transliteration) | pending-qualified-reviewer |
| insulin | الأنسولين | Blood-sugar hormone/therapy; the definite-article form الأنسولين is standard. | ✅ yes (transliteration) | pending-qualified-reviewer |
| amlodipine | أملوديبين | Calcium-channel blocker for hypertension/angina. | ✅ yes (transliteration) | pending-qualified-reviewer |
| losartan | لوسارتان | ARB (angiotensin-receptor blocker) for hypertension. | ✅ yes (transliteration) | pending-qualified-reviewer |
| simvastatin | سيمفاستاتين | Statin for cholesterol; often paired with lifestyle advice. | ✅ yes (transliteration) | pending-qualified-reviewer |
| rosuvastatin | روسوفاستاتين | Statin for cholesterol, high-intensity regimens. | ✅ yes (transliteration) | pending-qualified-reviewer |
| metoprolol | ميتوبرولول | Beta blocker for heart rate/blood pressure/angina. | ✅ yes (transliteration) | pending-qualified-reviewer |
| hydrochlorothiazide | هيدروكلوروثيازيد | Thiazide diuretic for hypertension/edema. | ✅ yes (transliteration) | pending-qualified-reviewer |
| furosemide | فوروسيميد | Loop diuretic for edema/heart failure. | ✅ yes (transliteration) | pending-qualified-reviewer |
| warfarin | وارفارين | Anticoagulant; many food/drug interactions — always defer dosing questions to the clinician. | ✅ yes (transliteration) | pending-qualified-reviewer |
| clopidogrel | كلوبيدوغريل | Antiplatelet used after stents/stroke. | ✅ yes (transliteration) | pending-qualified-reviewer |
| pantoprazole | بانتوبرازول | Proton-pump inhibitor, alternative to omeprazole. | ✅ yes (transliteration) | pending-qualified-reviewer |
| salbutamol | سالبوتامول | Inhaled bronchodilator for asthma relief (albuterol in US naming). | ✅ yes (transliteration) | pending-qualified-reviewer |
| levothyroxine | ليفوتيروكسين | Thyroid-hormone replacement; morning fasting administration matters. | ✅ yes (transliteration) | pending-qualified-reviewer |
| prednisone | بريدنيزون | Corticosteroid; never advise stopping abruptly — tapering is clinical. | ✅ yes (transliteration) | pending-qualified-reviewer |
| gabapentin | غابابنتين | Nerve-pain/anticonvulsant medication. | ✅ yes (transliteration) | pending-qualified-reviewer |
| diabetes | داء السكري | Chronic-disease education; formal MSA داء السكري in explanations rather than the colloquial السكري. | ⬜ no — pending review | — |
| hypertension | ارتفاع ضغط الدم | Chronic-disease education and lab-review chats; formal register. | ⬜ no — pending review | — |
| arthritis | التهاب المفاصل | Joint inflammation; general umbrella term — specify the type when known. | ⬜ no — pending review | — |
| asthma | الربو | Chronic respiratory condition; inhaler technique is a common question. | ⬜ no — pending review | — |
| pneumonia | التهاب الرئة | Acute lung infection — flag as needing medical attention. | ⬜ no — pending review | — |
| heart disease | أمراض القلب | Cardiovascular umbrella term. | ⬜ no — pending review | — |
| depression | الاكتئاب | Mental-health term; sensitive, non-judgmental register, never dismissive. | ⬜ no — pending review | — |
| anxiety | القلق | Mental-health term; distinguish everyday worry from clinical disorder. | ⬜ no — pending review | — |
| infection | العدوى | General pathological term. | ⬜ no — pending review | — |
| fever | الحمى | Common symptom in triage chats. | ⬜ no — pending review | — |
| chronic disease | مرض مزمن | Core user population of the platform; long-term-management framing. | ⬜ no — pending review | — |
| blood pressure | ضغط الدم | Vital sign; chronic-disease monitoring conversations. | ⬜ no — pending review | — |
| blood sugar | سكر الدم | Diabetes self-monitoring term; keep distinct from HbA1c (long-term marker). | ⬜ no — pending review | — |
| blood test | تحليل الدم | General lab-work term. | ⬜ no — pending review | — |
| MRI scan | فحص الرنين المغناطيسي | Imaging study; often anxiety-laden — neutral, calm register. | ⬜ no — pending review | — |
| CT scan | فحص التصوير المقطعي | Imaging study. | ⬜ no — pending review | — |
| X-ray | الأشعة السينية | Imaging study. | ⬜ no — pending review | — |
| biopsy | الخزعة | Tissue-sampling procedure; can cause anxiety — neutral register. | ⬜ no — pending review | — |
| vaccination | التطعيم | Preventive-care term. | ⬜ no — pending review | — |
| surgery | الجراحة | Procedure umbrella term; pre/post-operative questions. | ⬜ no — pending review | — |
| physical therapy | العلاج الطبيعي | Rehabilitation/referral term. | ⬜ no — pending review | — |
| tablet | قرص | Dosage form on prescriptions and reminders. | ⬜ no — pending review | — |
| capsule | كبسولة | Dosage form on prescriptions and reminders. | ⬜ no — pending review | — |
| injection | حقنة | Administration route. | ⬜ no — pending review | — |
| oral medication | دواء عن طريق الفم | Administration route. | ⬜ no — pending review | — |
| topical application | تطبيق موضعي | Administration route (skin); note the Arabic is a calque — verify with reviewer. | ⬜ no — pending review | — |
| dosage | الجرعة | Amount/frequency instructions on prescriptions; the app's most frequent instruction term. | ⬜ no — pending review | — |
| dose | جرعة | Single dose; reminder-engine and adherence contexts (indefinite form vs. dosage). | ⬜ no — pending review | — |
| frequency | عدد المرات | How often a dose is taken. | ⬜ no — pending review | — |
| every morning | كل صباح | Timing instruction on prescriptions. | ⬜ no — pending review | — |
| every evening | كل مساء | Timing instruction on prescriptions. | ⬜ no — pending review | — |
| twice daily | مرتين يومياً | Frequency instruction on prescriptions. | ⬜ no — pending review | — |
| three times daily | ثلاث مرات يومياً | Frequency instruction on prescriptions. | ⬜ no — pending review | — |
| once daily | مرة واحدة يومياً | Frequency instruction on prescriptions. | ⬜ no — pending review | — |
| after meals | بعد الوجبات | Food-timing instruction. | ⬜ no — pending review | — |
| before meals | قبل الوجبات | Food-timing instruction. | ⬜ no — pending review | — |
| with food | مع الطعام | Food-timing instruction (reduces stomach upset). | ⬜ no — pending review | — |
| without food | على معدة فارغة | Food-timing instruction (fasting absorption). | ⬜ no — pending review | — |
| as needed | عند الحاجة | PRN instruction; advise against exceeding daily maximums. | ⬜ no — pending review | — |
| missed dose | جرعة فائتة | Adherence outcome term (reminder engine + notification texts). | ⬜ no — pending review | — |
| medication adherence | الالتزام الدوائي | Core platform/research concept; formal research register. | ⬜ no — pending review | — |
| over-the-counter | يُصرف بدون وصفة طبية | OTC classification; pharmacist-advice framing. | ⬜ no — pending review | — |
| side effect | أثر جانبي | Adverse-reaction reporting; persistent/severe effects → clinician. | ⬜ no — pending review | — |
| nausea | الغثيان | Common symptom and medication side effect. | ⬜ no — pending review | — |
| dizziness | الدوخة | Common symptom; safety concern for falls/driving. | ⬜ no — pending review | — |
| headache | الصداع | Common symptom. | ⬜ no — pending review | — |
| stomach pain | ألم المعدة | Symptom; escalate when severe or persistent. | ⬜ no — pending review | — |
| allergic reaction | تفاعل تحسسي | Safety-critical; severe forms (breathing difficulty) are an emergency. | ⬜ no — pending review | — |
| rash | طفح جلدي | Dermatological symptom; possible drug reaction — timing matters. | ⬜ no — pending review | — |
| palpitations | خفقان القلب | Cardiac symptom; ask about duration/triggers; red flag when paired with chest pain. | ⬜ no — pending review | — |
| shortness of breath | ضيق التنفس | Red-flag symptom — urgent when sudden or severe. | ⬜ no — pending review | — |
| chest pain | ألم في الصدر | Emergency red flag; NEVER triage down — direct to emergency services. | ⬜ no — pending review | — |
| fatigue | التعب والإرهاق | Non-specific symptom; common in chronic disease and as a medication effect. | ⬜ no — pending review | — |
| vomiting | التقيؤ | Symptom; dehydration risk for elderly users. | ⬜ no — pending review | — |
| diarrhea | الإسهال | Symptom; hydration guidance, medication-review question. | ⬜ no — pending review | — |
| constipation | الإمساك | Common GI symptom; classic opioid side effect. | ⬜ no — pending review | — |
| insomnia | الأرق | Sleep symptom; also a medication side effect. | ⬜ no — pending review | — |
| cough | السعال | Respiratory symptom; note dry vs productive when reported. | ⬜ no — pending review | — |
| sore throat | التهاب الحلق | Symptom; specify duration and fever presence. | ⬜ no — pending review | — |
| blurred vision | تشوش الرؤية | Symptom; can indicate blood-sugar swings — suggests a check. | ⬜ no — pending review | — |
| swelling | التورّم | Symptom/sign; note location and one-sidedness (edema vs other causes). | ⬜ no — pending review | — |
| hemoglobin | الهيموغلوبين | Anemia lab marker in uploaded report analysis. | ⬜ no — pending review | — |
| HbA1c | السكر التراكمي (الهيموغلوبين السكري) | 3-month diabetes-control marker; keep both names — السكر التراكمي is what patients know. | ⬜ no — pending review | — |
| cholesterol | الكوليسترول | Cardiovascular lab marker; lifestyle + medication context. | ⬜ no — pending review | — |
| triglycerides | الدهون الثلاثية | Lipid-panel component. | ⬜ no — pending review | — |
| creatinine | الكرياتينين | Kidney-function marker; medication-dosing relevance. | ⬜ no — pending review | — |
| white blood cells | كريات الدم البيضاء | Infection/inflammation marker. | ⬜ no — pending review | — |
| platelets | الصفائح الدموية | Clotting marker. | ⬜ no — pending review | — |
| liver enzymes | إنزيمات الكبد | Liver-function panel (ALT/AST umbrella). | ⬜ no — pending review | — |
| consult doctor | استشر الطبيب | Standard professional-referral wording in agent answers. | ⬜ no — pending review | — |
| emergency | حالة طارئة | Escalation keyword — must ALWAYS render correctly; pairs with locale-aware emergency numbers. | ⬜ no — pending review | — |
| contraindication | موانع الاستخدام | Professional register; explain plainly in patient-facing text. | ⬜ no — pending review | — |
| interaction | تفاعل دوائي | Drug-interaction context (see drug-interactions.ts). | ⬜ no — pending review | — |
| refill | إعادة صرف الوصفة | Adherence/reminder context; running-out-of-medication nudges. | ⬜ no — pending review | — |
| prescription | الوصفة الطبية | Medication workflow term. | ⬜ no — pending review | — |
| milligrams | ملليغرام | Unit on prescriptions/lab results. | ⬜ no — pending review | — |
| mg | ملغ | Abbreviated unit on prescriptions. | ⬜ no — pending review | — |
| milliliters | ملليلتر | Liquid-medication unit. | ⬜ no — pending review | — |
| ml | مل | Abbreviated liquid unit. | ⬜ no — pending review | — |
| hours | ساعات | Time unit in instructions/reminders. | ⬜ no — pending review | — |
| days | أيام | Time unit in instructions/treatment courses. | ⬜ no — pending review | — |
| weeks | أسابيع | Time unit in follow-up guidance. | ⬜ no — pending review | — |
| months | أشهر | Time unit in chronic-disease management. | ⬜ no — pending review | — |
