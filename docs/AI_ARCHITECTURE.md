# MedSync AI — معمارية الوكلاء المتخصصين (AI Architecture)

| البيانات الوصفية | القيمة |
|---|---|
| **Architecture Version** | 2.0.0 |
| **Last Verified** | 2026-09-29 |
| **Safety Policy Version** | `2026-09-29.1` (`SAFETY_RULES_VERSION`، قابلة للتوسيع عبر `EMERGENCY_KEYWORDS_EXTRA`/`URGENT_KEYWORDS_EXTRA`) |
| **Agent Version** | 2.0.0 (يُعاد في كل رد من البوابة) |
| **API surface** | `/api/agents` (البوابة) · `/api/agents/{medical,medicine,personal-health,emergency,vision,chat,reports}` · `/api/ai-monitoring` |
| **DB schema** | `prisma/schema.prisma` (أُضيف `User.status` / `User.tokenVersion` في 2026-09-29) |

> **المرجع:** مواصفة المالك (55 قسماً، 2026-09-29) — "4 متخصصين + Router + Safety Gateway +
> Vision Pipeline + Provider Abstraction + Tool Permissions + Handoff + Output Validation +
> Fallback — وليس 4 Chatbots".
> هذه الوثيقة تسجّل **ما نُفِّذ فعلياً** وأين يعيش في الكود، وتحفظ عقد الصدق: ما لم يُنفَّذ مذكور صراحة.

---

## 1. البنية المنفَّذة (§53)

```
                         USER
                           │
                  ┌────────▼────────┐
                  │   AI GATEWAY    │  src/lib/server/ai/gateway.ts
                  │  POST /api/agents│
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │ SAFETY ROUTER   │  safetyCheck() — emergency/urgent keywords
                  └────────┬────────┘  (bilingual EN/AR, deterministic;
                                     SAFETY_RULES_VERSION 2026-09-29.1،
                                     قوائم كلمات قابلة للتوسيع من env)
               ┌───────────┴───────────┐
          Emergency?                 No
               │                       │
               ▼                       ▼
       Emergency Agent          INTENT CLASSIFIER  classifyIntent()
       + severity tier          (personal-history > lifestyle > medicine > medical)
       + escalation line               │
       + locale-aware number           │
         (timezone → 101/911/112)
              ┌────────────────────────┼────────────────────┐
              ▼                        ▼                    ▼
       Medical Agent          Medication Agent      Personal Health
       (own module)           (own module)          (own module + tools)
              │                        │                    │
              └────────────────────────┼────────────────────┘
                                       │
                              CONTEXT BUILDER  buildContext()
                              (permitted tools only, per question)
                                       │
                              VERIFICATION GATE (P0-43 — حتمي)
                              certainty-violation correction, injection
                              markers, internal-id warnings + handoff
                              QUESTION-FIRST, escalation, severity
                              (النتيجة → AiLog safetyResult
                              بصيغة |verify:pass|warnings|corrected)
                                       │
                              AiLog (data-minimized audit)
                                       │
                                  USER RESPONSE

  Image/PDF:  POST /api/agents/vision
              File Validator → Vision chain (Gemini → z-ai VLM)
              → Structured extraction → Correct Specialist → Verify notice

  Monitoring: GET /api/ai-monitoring → #/ai-monitoring page
```

## 2. خريطة الملفات

| المكوّن | الملف | الوظيفة |
|---------|-------|---------|
| **بوابة AI** | `src/lib/server/ai/gateway.ts` | safetyCheck + classifyIntent + buildContext + تنفيذ الوكيل + تحقق المخرجات + handoff ب قفزة واحدة + AiLog |
| **سجل الوكلاء** | `src/lib/server/ai/agent-registry.ts` | مصفوفة الصلاحيات (§19)، أذونات الأدوات لكل وكيل (§20-21)، أهداف handoff المسموحة (§24-26)، أنماط لغة التحويل |
| **طبقة الأدوات** | `src/lib/server/ai/tools.ts` | 6 أدوات بتفويض في الكود (assertPermission قبل أي بيانات): getMedications / checkInteractions / getDoseHistory / getAdherenceSummary / getHealthProfile / getStoredRiskExplanation |
| **تجريد المزودين** | `src/lib/server/ai/providers.ts` | واجهة ModelProvider (generate + analyzeImage)، سجل groq/gemini/zai، سلاسل من env (§54)، runProviderChain (§30: نفس الوكيل + مزود مختلف) |
| **خط الرؤية** | `src/app/api/agents/vision/route.ts` | صور الأدوية/التقارير: تحقق ملف → استخراج منظّم محمي من الحقن → الأخصائي الصحيح → إشعار التحقق (§52) |
| **المراقبة** | `src/app/api/ai-monitoring/route.ts` + `src/pages/aiMonitoring.jsx` | إحصاءات لكل وكيل: طلبات/نجاح/fallback/زمن p95/handoffs/تدخلات سلامة + مصفوفة الصلاحيات + سلاسل المزودين الحالية |
| **الواجهة** | `src/pages/agents.jsx` | 6 خيارات §50 (4 أخصائيين عبر preferredAgent hint + تحليل تقرير + رفع صورة)، مودال المعاينة+النمط (§51)، لوحة نتيجة الرؤية + إشعار التحقق (§52)، شارات severity/handoff |
| **اختبارات** | `scripts/test-agent-suite.ts` | TEST-MED-001/002, TEST-PH-001, TEST-ER-001, TEST-ROUTER-AR, TEST-URGENT, TEST-SAFETY-PREF, TEST-HANDOFF, TEST-SEC-001/002/003, TEST-MON-001 — **25/25 PASS** |
| **سجل التدقيق** | `prisma/schema.prisma` → `AiLog` | requestId/user/agent/provider/model/intent/severity/fallbackUsed/handoff/safetyResult/toolCalls/latencyMs — **بلا نص طبي كامل** (§35 data minimization) |

## 3. القواعد الصارمة — كيف فُرِّضت

| القاعدة (القسم) | التنفيذ في الكود |
|---|---|
| الطوارئ أولاً دائماً (§23، §41) | `safetyCheck()` قبل أي شيء؛ حتى `preferredAgent` لا يتجاوزها — المسارات المباشرة أيضاً (`wrapDirectAgentCall` يعيد التوجيه للطوارئ) |
| لا يجيب وكيل عن كل شيء (§6، §25-26) | الحدود في الـ prompt الأصلي (نقل حرفي) + كشف علامات التحويل في المخرجات + handoff تلقائي بقلبة واحدة THROUGH الروتر |
| Handoff عبر الروتر فقط (§24) | `runGateway` هو من ينفذ القفزة — لا اتصال وكيل←وكيل مباشر |
| الحماية في الكود لا الـ prompt فقط (§21) | `assertPermission` قبل كل أداة؛ رفض مسجل (`safetyResult: tool_denied`) |
| تصفية السياق (§36-37) | `buildContext` يختار الأدوات حسب كلمات السؤال — لا يرسل كل شيء أبداً |
| ML ليس وكيلاً (§42-44) | `getStoredRiskExplanation` يقرأ التنبؤ **المخزّن** فقط؛ الـ LLM يشرح ولا يعيد الحساب |
| الصور لا تذهب لنموذج نصي (§17، §31) | `supportsVision` في الواجهة — Groq يتخطى الصور تلقائياً؛ سلسلة VISION: gemini→zai |
| حقن الـ prompt (§40) | تعليمة أمنية صريحة + المحتوى المستخرج يُمرَّر كـ DATA داخل محددات، أبداً كـ system instruction |
| التعرف البصري ليس إثباتاً (§52) | إشعار تحقق ثنائي اللغة في كل رد رؤية + `confidence: "needs_verification"` (§32) |
| fallback لا يغيّر التخصص (§30) | الوحدات الأربع تحتفظ بموجهها؛ السلسلة داخل الوحدة تعيد نفس الـ prompt لمزود آخر |
| رفض آمن عند فشل الجميع (§29، §31) | رسالة "أدخل اسم الدواء يدوياً" — لا تخمين أبداً |
| تفضيل المستخدم لا يتجاوز الروتر (§50) | `preferredAgent` = hint؛ الروتر يصحح: الطوارئ تفوز دائماً + عبارات ملكية البيانات ("my adherence") تصحَّح لـ Personal Health |

## 4. توجيه النماذج — إعداد فقط (§54)

`.env` (القيم الحالية):
```env
MEDICAL_PRIMARY=groq        MEDICAL_SECONDARY=gemini   MEDICAL_FALLBACK=zai
MEDICATION_PRIMARY=groq     MEDICATION_SECONDARY=gemini MEDICATION_FALLBACK=zai
PERSONAL_PRIMARY=groq       PERSONAL_SECONDARY=gemini   PERSONAL_FALLBACK=zai
EMERGENCY_PRIMARY=groq      EMERGENCY_SECONDARY=gemini  EMERGENCY_FALLBACK=zai
VISION_PRIMARY=gemini       VISION_FALLBACK=zai
# النماذج — لكل وكيل على حدة (P0-17/18: استُبدلت المتوقفة llama-3.3-70b/llama-4-scout في 2026-09-29):
MEDICAL_CHAT_MODEL=openai/gpt-oss-120b       MEDICAL_SUMMARY_MODEL=openai/gpt-oss-20b
MEDICATION_CHAT_MODEL=openai/gpt-oss-120b    MEDICATION_SUMMARY_MODEL=openai/gpt-oss-20b
PERSONAL_CHAT_MODEL=openai/gpt-oss-120b      PERSONAL_SUMMARY_MODEL=openai/gpt-oss-20b
EMERGENCY_CHAT_MODEL=openai/gpt-oss-120b     EMERGENCY_SUMMARY_MODEL=openai/gpt-oss-20b
REPORT_CHAT_MODEL=openai/gpt-oss-120b
GROQ_CHAT_MODEL=openai/gpt-oss-120b          # نموذج groq في طبقة providers.ts المشتركة
```
تغيير نموذج/مزود **لا يتطلب تعديل أي وكيل أو الواجهة** — كل معرّف نموذج قابل للتجاوز من
`.env` **لكل وكيل على حدة** (الفصل محفوظ: كل وكيل بمثيلاته الخاصة). النموذجان المتوقفان
`llama-3.3-70b-versatile` و`meta-llama/llama-4-scout-17b-16e-instruct` استُبدلا في تدقيق
2026-09-29 بـ `openai/gpt-oss-120b` (الإجابات) و`openai/gpt-oss-20b` (الملخصات)
(`scripts/modernize-agents.ts` يسجّل الهجرة).

**الموثوقية (P1-44/45):** مهلة لكل استدعاء (45ث نص / 90ث رؤية) + قاطع دائرة داخل الذاكرة
(3 إخفاقات ← 60ث مفتوح ← فحص نصف مفتوح) — الحالة مكشوفة عبر `providerHealth()` في
`/api/ai-monitoring`؛ وكل مسار API يعيد ترويسة `x-request-id` من `withMetrics`.

**حالة الشبكة الحالية (مختبرة):** مفاتيح Groq/Google صالحة لكن شبكة بيئة المعاينة محجوبة
جغرافياً من كليهما → تجيب السلسلة عبر z-ai (GLM). عند النشر من شبكة مدعومة تعود
Groq/Gemini تلقائياً بلا أي تغيير.

## 5. مصفوفة الصلاحيات (§19)

معروضة حيّة في صفحة المراقبة (`capabilitiesMatrix` من `agent-registry.ts`):
10 قدرات × 4 وكلاء (full/limited/none/handoff/owner_only) — تطابق جدول المواصفة حرفياً،
بما فيها الصفان الممتنعان دوماً: **تغيير الأدوية ✗** و**تشخيص الأمراض ✗** للجميع.

## 6. مخرجات منظّمة (§28)

كل رد من البوابة يحمل (إضافة إلى `output` المتوافق مع الواجهة القائمة):
```json
{
  "routedTo": "personal-health", "handoffFrom": "medicine",
  "intent": "PERSONAL_HEALTH", "severity": null,
  "confidence": "high|medium|needs_verification",
  "needs_handoff": false, "handoff_agent": null,
  "provider": "zai-glm", "model": "GLM (z-ai gateway)", "fallbackUsed": true,
  "toolCalls": ["getAdherenceSummary", "getDoseHistory"],
  "requestId": "…", "latencyMs": 1166,
  "router": { "mechanism": "…", "rule": "…", "matched": ["…"], "safetyResult": "ok" }
}
```

**إضافات تدقيق 2026-09-29 (الإصدار 2.0.0):** حقول منظّمة إضافية — `actions` و`uncertainty`
و`needsProfessionalReview` و`verification` + `agentVersion: "2.0.0"` و`policyVersion`
(SAFETY_RULES_VERSION) و`modelVersion`؛ ويُسجَّل قرار بوابة التحقق الحتمية في `safetyResult`
بصيغة `|verify:pass|warnings|corrected`.

## 7. نتائج الاختبار الحية (2026-09-29)

- **طقم الاختبار: 25/25 PASS** (توجيه EN+AR، أداة شخصية بالبيانات، طوارئ بتصنيف الخطورة
  وسطر التصعيد، أرجحية السلامة على التفضيل، handoff بقلبتين مختلفتين، أمن: حقن/بلا توكن/
  نوع ملف مرفوض، مراقبة تجمع كل شيء).
- **طقم الأمن (تدقيق 2026-09-29 الشامل): 22/22 PASS** (`scripts/test-security.ts`): مصفوفة المصادقة
  (مجهول/توكن خردة/منتهي/حساب محذوف/حساب معطّل/tokenVersion غير مطابق)، BOLA
  (تقرير/دواء/تحليلات لمستخدم أجنبي)، عزل غرف السوكيت (سوكيت المهاجم لا يستقبل إشعارات
  الضحية)، رفض PDF المزيّف (فحص magic bytes)، حدود المعدل، وإبطال الخروج. انحدار كامل بعدها:
  بوابة 25/25 + بيانات 9/9 + دورة حياة الدواء 40/40 + الموقع كامل 56/56 + E2E متصفح نظيف.
- **الرؤية E2E:** صورة علبة Metformin 500mg مولّدة → استخراج `{drugName: "METFORMIN",
  strength: "500 mg"}` + تفاعلات دوائية مع أدوية المستخدم + تفسير أخصائي الأدوية + إشعار
  التحقق — في الواجهة وفي curl.
- **المتصفح:** الشارات (Routed to / Redirected from / Severity) تعمل، عربي RTL بلا فائض،
  موبايل 390/390.

## 8. ما لم يُنفَّذ بعد (بأسبابه — عقد الصدق)

| البند | السبب |
|-------|-------|
| Function calling حقيقي داخل الاستدلال (LLM يقرر الأداة أثناء التوليد) | التنفيذ الحالي context-builder حتمي — **أكثر أماناً وقابلية للتدقيق** (نفس فلسفة §23 الروتر الحتمي). الترقية لاحقاً للنماذج الداعمة ممكنة عبر نفس طبقة الأدوات |
| Metadata stripping للصور (EXIF) | الصور تعالج في الذاكرة ولا تُخزَّن أبداً؛ التنظيف الحقيقي يحتاج مكتبة صور |
| مصادر طبية خارجية موثقة لكل حقيقة دوائية (§34 sources) | جدول التفاعلات الثابت (18 زوجاً) يذكر source لكل تفاعل؛ المصادر الخارجية المباشرة مؤجلة |
| Evaluation نوعية لمحتوى إجابات كل وكيل (§46 بمعايير الجودة) | طقم §47 يغطي التوجيه/السلامة/الأمن؛ تقييم جودة المحتوى يحتاج مجموعة معايير بشرية — مطلوب للدراسة |
| `/ai-monitoring` كصفحة مشغل بإدارة أدوار | الصفحة متاحة لكل مستخدم مصادق (بياناته فقط عبر AiLog user-scoped... انظر ملاحظة) |

**ملاحظة أمان (صادقة):** `/api/ai-monitoring` يعرض حالياً مقاييس مجمّعة عبر كل المستخدمين
(بلا محتوى طبي) لأي مستخدم مصادَق — مقبول لمرحلة التطوير/العرض، ويحتاج قيد دور
(operator) قبل أي نشر حقيقي، موثق في SECURITY_ASSESSMENT.

## 9. أوامر إعادة التحقق

```bash
bun run scripts/test-agent-suite.ts    # 25 فحص توجيه/سلامة/أمن — يجب: 25/25
bun run scripts/test-security.ts       # 22 فحص أمن المصادقة/السوكيت — يجب: 22/22
bun run scripts/state-snapshot.ts      # حالة المنصة
curl -s localhost:3000/api/healthz     # مزودو AI
# المتصفح: #/agents (الموجّه + رفع صورة) و #/ai-monitoring (المراقبة)
```
