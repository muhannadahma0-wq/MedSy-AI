# MedSync-AI — Quick Start (التشغيل السريع)

> النسخة النهائية · 2026-10-17 · Next.js 16 + Prisma (SQLite) + Socket.IO + 4 AI Agents

## المتطلبات

- **Bun 1.3+** (موصى به) أو Node.js 20+
- ملف `.env` موجود في جذر المشروع (مضمَّن في هذه النسخة — انظر التحذير أدناه)

## خطوات التشغيل

```bash
# 1) تثبيت الاعتماديات
bun install

# 2) تهيئة قاعدة البيانات
#    (قاعدة البيانات النهائية مضمَّنة جاهزة في db/custom.db مع بيانات العرض)
#    لتجديد المخطط فقط:  bun run db:push
bun run db:generate

# 3) تشغيل خادم التطبيق
bun run dev          # ← http://localhost:3000

# 4) (اختياري — للإشعارات الفورية) خدمة Socket.IO
cd mini-services/socket-service
bun install
bun run dev          # ← منفذ 3003 (Socket.IO) + 3004 (جسر الإصدار الداخلي)
```

## حساب العرض التجريبي

| الحقل | القيمة |
|---|---|
| البريد | `demo@medsync.ai` |
| كلمة المرور | `demo1234` |

## ⚠️ تحذير أمني مهم

ملف `.env` **مضمَّن في هذه النسخة** ويحتوي على مفاتيح حقيقية:
- `JWT_SECRET` — سر توقيع الجلسات (مطلوب أيضاً في `mini-services/socket-service/.env` بنفس القيمة)
- `GROQ_API_KEY` + `GOOGLE_API_KEY` — مفاتيح مزودي الذكاء الاصطناعي

**لا ترفع هذا الملف أبداً إلى GitHub أو تشاركه** — `.gitignore` يستثنيه تلقائياً.
للنسخة العلنية استخدم `.env.example` واملأ قيمك الخاصة.

## ملاحظات المزودين (موثقة بشفافية)

سلسلة المزودين: **Groq → Gemini → z-ai (GLM)** لكل وكيل على حدة.
المفاتيح تعمل من شبكات المناطق المدعومة فقط؛ من شبكات محجوبة (مثل منطقة الخروج الحالية)
تتراجع السلسلة تلقائياً إلى z-ai مع علامة `fallbackUsed: true` — راجع `docs/LIMITATIONS.md`.

## فحوص الجاهزية بعد التشغيل

```bash
curl http://localhost:3000/api/healthz   # {"status":"ok", ...}
bun run lint                             # 0 أخطاء
bun run scripts/verify-data.ts           # فحوص سلامة البيانات
bun run scripts/test-security.ts         # بطارية الأمن 23/23
```

## خريطة سريعة

| المسار | المحتوى |
|---|---|
| `src/` | كل الكود (واجهة + 62 مسار API + 14 نموذج Prisma + 4 وكلاء AI) |
| `docs/` | 17 وثيقة حديثة — ابدأ بـ `FULL_RECORD.md` |
| `db/custom.db` | قاعدة البيانات النهائية (19 مستخدماً — بيانات عرض كاملة + حساب المالك النشط) |
| `mini-services/` | خدمة Socket.IO المستقلة |
| `ml-artifacts/` | بيانات نموذج ML النشط (Logistic Regression) |
| `worklog.md` | السجل القانوني الكامل لكل المهام |
