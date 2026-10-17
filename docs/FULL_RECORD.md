# MedSync-AI — The Complete Line-by-Line Record of Every Addition

>
> **ARCHIVAL NOTE (2026-10-17, Task 28):** at the owner's request the historical source
> documents cited throughout this record (`CHANGES.md`, `DETAILED_ADDITIONS.md`,
> `EXECUTION_PLAN.md`, `MASTER_REVIEW_100.md`, `BASELINE_REPORT.md`, `BUG_REGISTER.md`,
> `DEFECT_REGISTER.md`, `PERFORMANCE_REPORT.md`, `REGRESSION_REPORT.md`, `SECURITY_REVIEW.md`,
> and the MIGRATION_* / DATA_MIGRATION_* files) were removed from `docs/`. Their content is
> consolidated in THIS file and in `worklog.md` (the canonical log). The 17 remaining files
> in `docs/` describe the living system.
> **Compiled:** 2026-10-01 · **Language:** English (third file of the owner's documentation series)
> **This file answers:** *"Write a file MORE detailed than every line of the conversation — the things
> you added to the project from the very first line of the conversation; review every stage; detail
> everything added, from the largest to the smallest."*
>
> **Companion files (read together):**
> - `docs/CHANGES.md` — chronological changelog (compact)
> - `docs/DETAILED_ADDITIONS.md` — size-ordered inventory (medium detail)
> - **THIS FILE** — the maximal record: every task from the first line of the conversation,
>   every micro-addition, every field, every endpoint, every fix, every number.
>
> Sources of truth: `worklog.md` (1,607 lines, 72 task entries), the live repository (all counts
> re-measured 2026-10-01), `docs/MASTER_REVIEW_100.md`, `docs/EXECUTION_PLAN.md`.

---

## 0. Master Numbers (all re-measured in the repository)

| Metric | Value |
|--------|-------|
| Total source lines (`src/`, ts/tsx/js/jsx) | **35,134** |
| API route files | **62** (23 route groups) |
| Prisma models | **14** |
| Pages / components / React contexts | **18 / 15 / 6** |
| `t()` translation call sites | **1,097** (word-boundary `\bt\(` count — corrected 2026-10-09 from an earlier 1,257 regex miscount) |
| Test & ops scripts | **20** (19 TS, 5,022 lines + 1 shell, 37 lines) |
| Total test checks in the battery | **350** (+9 data checks) — all passing 2026-10-01, re-verified 2026-10-09 |
| Documentation files | 18 in `docs/` (17 named below + VERIFICATION_REPORT.md, the audit of record) + README + worklog |
| Worklog task entries | 73 unique Task IDs (74 `^Task ID:` sections — `7-verify` appears twice) |
| AI agents registered | 4 specialists + router + vision + report + translation |
| Platform data | snapshot 2026-10-01: 15 users · 38 medications · 1,398 dose events · 592 risk predictions · arms 6/7 (live counts grow with engine uptime — 2026-10-09 audit: 16 users incl. 3 owner Gmail accounts · 38 meds · arms 6/7; events/predictions regenerate as the reminder engine runs) |
| Active ML model | `lr-v20260929102844` — ROC-AUC 0.6926 / PR-AUC 0.7697 / Brier 0.2165 / logLoss 0.6294 (temporal 757/325, prevalence 0.579) |

---

# PART I — THE STAGE-BY-STAGE RECORD (from the first line of the conversation)

> Every task below is a real `worklog.md` entry. Sub-bullets are the **actual additions made in
> that task**, at line-level granularity. Nothing is paraphrased away.

---

## Stage 1 — Working Prototype v1 (Task 1)

**Owner request:** build a working prototype of the graduation-project plan — WP1 (UI/UX redesign,
6-section IA), WP4 (Arabic + RTL), working previews of WP2 (adherence/risk) and WP3 (grounded AI
assistant).

**Additions:**
- Extracted and reviewed the uploaded original repo at `upload/medsync-original/` (models:
  Medication/todaysMedicine, agents, report analysis, i18n en/es/hi).
- **Prisma schema v1** (SQLite): `Medication`, `DoseEvent` (WP0 data foundation), `Report`.
- **Bilingual dictionaries** (ar/en, ~200 keys) in `src/lib/i18n.ts`; `t(key, vars)` via Zustand
  store; Arabic default; full RTL via `<html dir>`.
- **Medical data layer:** `DRUG_CATALOG` (autocomplete, Arabic names), curated `INTERACTION_TABLE`
  (7 pairs, ar/en descriptions, severity), emergency keyword detection (ar+en).
- **WP2 preview:** `riskHeuristic()` (hour, weekday, doses/day, streak, misses-last-7d) +
  `riskLevel`; streak computation; insights aggregation (56-day heatmap, weekday taken/missed,
  hour buckets, week vs. previous week, 7-day risk forecast).
- **RAG-lite retrieval:** sentence chunking + bilingual keyword-overlap scoring (stopwords ar+en
  incl. generic report words), top-3 passages, `NOT_FOUND` contract.
- **Prototype API routes:** `/api/medications` (GET/POST/DELETE + interactions), `/api/doses/today`,
  `/api/doses/[id]` (PATCH returns full day summary), `/api/insights`, `/api/assistant` (3 agents,
  system-prompt guardrails, emergency short-circuit, interaction-table citations), `/api/reports`
  (POST analyze via LLM strict JSON; GET list/detail; DELETE), `/api/reports/ask` (grounded QA with
  citations), `/api/seed`.
- **Deterministic demo seed** (mulberry32): 4 meds including a warfarin+aspirin major interaction,
  30-day dose history with evening/weekend personas, clean last 6 days for the streak, CBC sample
  report with pre-baked analysis.
- **UI shell:** teal medical design system (oklch tokens, no blue/indigo), light/dark via
  next-themes, `.hc` high-contrast variant, custom scrollbars, `prefers-reduced-motion`; Inter +
  Noto Sans Arabic fonts; sidebar (md+) + bottom 6-tab bar (mobile, safe-area); sticky footer
  (min-h-screen flex, pb-24 clears fixed nav); framer-motion tab transitions; hydration-safe
  mounted flag via `useSyncExternalStore`; first-visit auto-seed (localStorage).
- **6 views:** Today (adherence ring SVG, streak card, risk badge, smart-reminder callout, dose
  timeline with 44px Taken/Snooze/Skip), Medications (bdi names, show-original toggle,
  interaction alert + "explain with assistant" cross-tab seed, 3-step add wizard with autocomplete
  + live interaction warning + time/day/color pickers), Assistant (agent chips, persistent safety
  banner, emergency dialog 101/911/112, quick-asks, chat with sources `<details>` panel), Reports
  (upload/analyze, sample fill, list, detail dialog: summary, numbered findings with source
  quotes, warnings, readability badge, grounded Q&A with citations, raw text disclosure), Insights
  (stat cards, week summary w/ WoW delta, 56-cell heatmap, Recharts bar + risk line, hour-bucket
  bars), Settings (language, theme, 4-step font scale, high contrast, reduced-motion note, reset
  demo data, about/attribution).
- Fixed during verification: retrieval threshold 2→1 + generic-word stopwords; seed probabilities
  (streak 6, adherence 89%, risk medium); setState-in-effect lint rule; ESLint ignores for
  upload/examples/skills; removed Prisma query logging.

---

## Stage 2 — Full Rebuild from the Original Repo (Task 2)

**Owner request:** rebuild using ONLY the attached original repo — faithful port of client
(React/Vite) + server (Express/MongoDB) onto the sandbox stack.

**Additions:**
- Read the ENTIRE original: client (App.jsx, main.jsx, 6 contexts, 12 components, 15 pages,
  services: api client, socketService, offline idb queue, network) and server (index.js mounts,
  auth routes, 12 route files, controllers, 7 Mongoose models, utils: 4 LLM agent models,
  drugInteractionChecker, medicineParser, readabilityChecker, translationService, languageConfig,
  medicalTerminology, reportAnalysis, otpUtils, googleCalendar, emailService, notification
  scheduler).
- Removed all Task-1 prototype surface (old routes/libs/components/schema tables) after proving
  zero live importers.
- Installed original client deps: react-router-dom, axios, socket.io-client, idb,
  @react-oauth/google + pdfkit/pdf-parse for reports.
- **Verbatim client copy** into `src/` (pages/, components/, context/, hooks/, services/, App.jsx)
  with only sandbox adaptations: localhost:8080 → relative URLs; `import.meta.env` removed;
  `window.location.href='/x'` → `#/x` hash routes; anchor hrefs → hash; fixed original's broken
  import case (LandingPage/Agents/Notifications vs. actual filenames).
- **8 original-repo bugs fixed in passing** (each documented in code comments):
  1. unmounted `/api/streak` route (controller existed, never mounted — wired per client call),
  2. apiClient online path not parsing JSON / not sending Bearer,
  3. bulk controller iterating parse result wrongly,
  4. translation controller leaking an object,
  5. App.jsx import case mismatch,
  6. contexts not refreshing after SPA login (added `medsync-auth-changed` event),
  7. landing signup vs. OTP verification flow,
  8. medicine-parser `.success/.failed` mismatch.
- **`src/ClientApp.jsx`** (original main.jsx provider tree: GoogleOAuthProvider → HashRouter →
  Network → Socket → Notification → Medicine → App) + `page.tsx` dynamic `ssr:false` + minimal
  layout/globals.css.
- **Prisma schema porting all 7 Mongoose models:** User (incl. OTP/backupCodes/googleTokens/
  preferences), Medication (JSON dosageTimes/adherenceHistory), Report, Conversation,
  DailyNotification, HealthProfile.
- **13 server modules** in `src/lib/server/`: `jwt.ts` (HS256 sign/verify + authMiddleware port),
  `password.ts` (scrypt replaces bcrypt + otpUtils), `serialize.ts` (rows → Mongo-shaped API
  objects incl. `_id` alias), `language-config.ts`, `medical-terminology.ts`,
  `drug-interactions.ts` (RxNorm + ONCHigh layers with static 18-pair fallback, verbatim),
  `readability.ts` (Flesch-Kincaid en/es/hi, verbatim), `translation.ts` (Google-Translate
  replaced by z-ai LLM; placeholder pipeline/cache/retries preserved), `agents.ts` (4 agents with
  VERBATIM original prompts + past-2-conversation memory + Conversation persistence),
  `medicine-parser.ts`, `notifications.ts` (full personalized scheduler: before/onTime/after
  timers, DB dedupe, 10s test notification, personalization from adherence + conversation
  themes), `report-pdf.ts` (pdfkit replaces apitemplate.io, same payload/response shape),
  `report-analysis.ts` (PDF upload → analysis/chat/translate/readability with original prompts),
  `llm.ts` (shared z-ai client — later deleted in Stage 7).
- **27 API route files** mirroring Express mounts 1:1: auth (signup/login/verify-otp/resend-otp/
  google), medicine (add/bulk/today/status/check-interactions), streak, notification
  (regular-notify/today), agents (medical/emergency/medicine/personal-health/chat/reports),
  report (+analyze/chat/[id]/translate/[lang]/[id]/readability), translate (+batch/supported),
  languages (user/supported), preferences (+reset), health, analytics/[userId], oauth/login
  (503: no Google creds), calendar (status/sync).
- **OTP sandbox mode:** no SMTP → signup/resend return `demoOtp`; Signup.jsx shows a clearly
  marked demo banner.
- **Socket.IO mini-service** (`mini-services/socket-service/`, port 3003, path "/", JWT handshake
  auth, join-user rooms) + internal `/emit` bridge on 127.0.0.1:3004.
- `next.config.ts`: `serverExternalPackages=[pdf-parse, pdfjs-dist, pdfkit]`.
- **Demo seed** (`scripts/seed-demo.ts`): demo@medsync.ai/demo1234 verified user + health profile
  + 3 meds (Ferrous Sulfate/Cetirizine/Vitamin D3) with 14-day history + clean 6-day streak +
  analyzed CBC report + today's notifications.
- ESLint fixes (5 errors in copied original code, behavior-preserving).

---

## Stage 3 — E2E Verification + Hardening (Task 3)

**Owner request:** "اكمل" — continue; full E2E verification via agent-browser through the real
gateway path, fixing defects with minimal documented changes.

**Additions (4 targeted fixes):**
1. **"Mark Taken" dead button** — fixed the dose-marking flow on the dashboard.
2. **Mobile layout of the agents page** — fixed.
3. **Socket lifecycle after login/logout** — fixed (connect/disconnect with session).
4. **Double-submission prevention** on dose actions.

---

## Stage 4 — UX/UI Modernization #1 (Tasks 4, 4-a, 4-b, 4-c)

**Owner request:** "اجعله أفضل وعصري" (make it better and modern) — visual-only refresh.

**Additions:** 3 parallel frontend-styling-expert subagents modernized: (4-a) landing + auth
pages, (4-b) dashboard + core pages, (4-c) secondary pages — dark glassmorphism, emerald/teal
palette, gradient motions. 100% logic preserved.

---

## Stage 5 — UX/UI Redesign #2 "Clean Medical" (Tasks 5, 5-a, 5-b, 5-c)

**Owner request:** user rejected Task-4 dark glassmorphism as busy — "أنظف وعصري وسلس" (cleaner,
modern, smooth).

**Additions:** full LIGHT "Clean Medical" redesign (Linear/Notion-style cleanliness on a health
app) via 3 parallel subagents across landing+auth (5-a), dashboard+core (5-b), agents+secondary
pages (5-c). Logic untouched.

---

## Stage 6 — Complete Bilingualization EN/AR + RTL (Tasks 6-a … 6-f)

**Owner request:** "قم بعمل فقط لغة انجليزية وعربية" — English + Arabic ONLY.

**Additions:**
- **6-a (backend):** language restriction to {en, ar} across the backend; bilingual UI
  infrastructure (i18n + RTL + Arabic font); Arabic PDF reports; Arabic AI agent replies.
- **6-b:** landing + auth surfaces (Login, Signup 3-step OTP flow, OAuthCallback, OTPInput) +
  global LanguageSwitcher in the landing nav.
- **6-c:** Dashboard group (Dashboard.jsx, addMedication.jsx, BulkMedicineInput.jsx,
  InteractionWarning.jsx, HealthProfile.jsx) — zero logic changes.
- **6-d (retried):** reports pages group (Reports.jsx, ReportAnalysis.jsx full; agents.jsx /
  notifications.jsx / ReportChat.jsx verified).
- **6-e (retried):** shared components (Navbar, NotificationToast, TranslationBadge,
  ConnectCalendar, Loader/Button) + verified Settings/Analytics/LanguageSwitcher/
  LanguageSettings/ReadabilityIndicator.
- **6-f (final verification):** end-to-end bilingual verification + dashboard language switcher
  + final state reset.

---

## Stage 7 — Per-Agent AI Architecture Migration (Tasks 7, 7-verify)

**Owner request:** each agent separate with its own model and settings, as in the original
project, instead of one shared llm.ts (owner supplied both API keys: Groq gsk_…, Google AQ.Ab8…).

**Additions:**
- **4 standalone agent modules** (`medical-model.ts`, `emergency-model.ts`, `medicine-model.ts`,
  `personal-health-model.ts`), each with: its own LangChain `ChatGroq` instance, its own Gemini
  instance, its own memory, its own verbatim original prompt, its own 3-tier fallback chain.
- **Deleted the shared `llm.ts`** — separation is structural.
- **7-verify:** found the critical gap — the API keys were never actually persisted to `.env`
  (fixed); full browser re-verification of the chain (Groq → Gemini → z-ai).

---

## Stage 8 — "Rhythm" Soft-Dark v4 Identity (Tasks 8, 8-b, 8-c, 8-d, 8-e, 8-f)

**Owner request:** full redesign per the uploaded `MedSync-Dashboard-Redesign.png` mockup.

**Additions (5 parallel full-stack subagents + integration):**
- **8-b:** Dashboard.jsx restyled to the mockup (light 280px AppSidebar + dark slate canvas +
  white glass cards + mint hero).
- **8-c:** landingPage, Login, Signup, OAuthCallback.
- **8-d:** agents, Reports, ReportChat, ReportAnalysis.
- **8-e:** Analytics (dual-context: standalone + embedded in Dashboard), notifications, Settings.
- **8-f:** HealthProfile, addMedication + 7 shared components (LanguageSwitcher,
  LanguageSettings, InteractionWarning, ReadabilityIndicator, TranslationBadge, OTPInput,
  BulkMedicineInput).
- Design system: Playfair Display + Amiri serif headings, IBM Plex Sans Arabic body, emerald
  waves, glass cards, slate canvas. 100% logic preserved.

---

## Stage 9 — Predictive Intelligence Page (Task 9-ui)

**Additions:** `src/pages/intelligence.jsx` — ML risk-prediction surface on Rhythm v4:
48-hour per-dose risk forecast (expandable cards), per-feature signed contributions, model status
+ calibration, "Run Engine Tick" + "Retrain Model" buttons, bilingual EN/AR, nav/route wiring
into Dashboard/agents.

---

## Stage 10 — Intelligent Adherence Platform (Task 10, MEDSYNC-001…010)

**Owner request:** execute the comprehensive plan — transform MedSync into the Intelligent
Medication Adherence Platform.

**Additions (item by item):**
- **MEDSYNC-001 (baseline):** restored lost `.env` keys + added `SMART_REMINDERS=shadow`; removed
  dead v1 prototype surface; wrote `docs/BASELINE_REPORT.md` + `docs/BUG_REGISTER.md`.
- **MEDSYNC-002 (schema):** 4 new models — `DoseEvent` (unique medicationId+scheduledAt),
  `SmartReminder` (unique doseEventId+type+scheduledAt), `RiskPrediction` (features+explanation
  JSON), `ModelArtifact` (weights+metrics, isActive).
- **MEDSYNC-003 (dose events):** `lib/server/dose-events.ts` — `materializeDoseEvents` (2-day
  back / 7-day ahead window, respects startDate/endDate/dosageDays×dosageTimes),
  `migrateAdherenceHistory`, `autoTransitionMissed` (120-min grace),
  `syncDoseEventFromStatus` dual-write hooked additively into `/api/medicine/status`. Fixed
  BUG-007 (legacy record.date is the click moment → scheduledAt = atLocalTime(rec.date,
  rec.time); taken >30min late ⇒ delayed).
- **MEDSYNC-005 (adherence engine):** `lib/server/adherence-engine.ts` (confirmed/on-time/
  not-confirmed rates, streak from DoseEvents, weekday/slot/daily patterns).
- **MEDSYNC-007 (ML):** `lib/server/ml/{features,metrics,models,train,predict}.ts` — **12
  leakage-free features**, label = delayed|missed ("not confirmed on time"), rule baseline +
  standardized class-balanced L2 logistic regression, temporal 70/30 split, ROC-AUC
  (tie-corrected)/PR-AUC/Brier/logLoss/10-bin calibration/confusion, **evidence-based
  promotion** (LR activates only if temporal-test ROC-AUC ≥ baseline). Routes `/api/ml/train` +
  `/api/ml/status`.
- **MEDSYNC-004/008/009/010 (reminder engine):** `lib/server/reminder-engine.ts` +
  `src/instrumentation.ts` — 60s tick loop + boot recovery tick; plan before/onTime/after
  (original personalized generator reused verbatim) + **EXTRA escalation 15-min post-slot only
  for high-risk doses with honest reason from stored features**; shadow default (log-only), live
  delivers via the 3004 emit bridge + DailyNotification; >15-min-overdue ⇒ skipped;
  findUnique-then-create idempotency. `/api/notification/regular-notify` rewired to the engine
  preserving the `{success, message, scheduled}` contract.
- **New routes:** `/api/dose-events` (GET ranges + POST prepare/migrate/materialize),
  `/api/reminder-engine/tick`, `/api/intelligence/overview` (single-call page feed).
- **Data hygiene:** deleted 12 junk bulk-parser test meds + 121 DoseEvents + 144 RiskPredictions;
  re-prepared + retrained on the clean 12-med profile.

---

## Stage 11 — Study Endpoints + Better Models (Tasks 11-verify, 15, 14, 13, 12+16)

- **Task 15 (ML model selection):** `models.ts` gained `mulberry32(seed)` seeded RNG (zero
  Math.random in training); **RandomForestModel** (greedy binary splits minimizing weighted Gini,
  midpoint thresholds quantile-thinned to ≤16/feature, maxDepth 4, minLeafSize 2, seeded
  ceil(sqrt(d)) feature subsample per node, Laplace-smoothed leaf probs, forest = 60 trees each
  on a class-balanced bootstrap, mean tree prob clamped [0.01,0.99], importance = summed
  weighted-Gini reduction normalized to 1); **GradientBoostingModel** (logistic loss, base =
  clamped train log-odds, 60 rounds × depth-2 MSE regression trees on residuals, leaf = mean
  residual clamped [-2,2], F += 0.1·tree, sigmoid(F)); all JSON-serializable. `train.ts`:
  four-candidate comparison (baseline → LR → GB → RF) on the SAME temporal split; promotion =
  best ROC-AUC among baseline-beaters → tie-break lower Brier → tie-break simplicity; low-data →
  baseline stays with reason; small-dataset honesty note appended when resolvedEvents < 200.
  `predict.ts`: ActiveModelCache dispatch to all four kinds; global-importance explanations for
  RF/GB vs. signed per-dose contributions for baseline/LR; `explanationKind` field.
- **Task 14 (study infrastructure):** `study-stats.ts` (PURE): `wilsonInterval` (Wilson score
  95% CI), `newcombeDifference` (Newcombe hybrid-score method-10 CI for p1−p2, unrounded Wilson
  bounds internally), `deriveArmOutcomes`. Routes: `GET /api/study/status` (arm + engine mode +
  participants groupBy), `POST /api/study/assign` (OPERATOR endpoint, documented researcher-only),
  `GET /api/study/export` (pseudonymized CSV: participant = sha256(userId+salt).slice(16),
  medications = M01/M02… indexed by sorted id, never selects name/email/pillName/notes/doctor;
  one row per DoseEvent LEFT-joined per event–reminder pair + latest RiskPrediction; RFC-4180
  escaping, CRLF, `text/csv` + attachment headers; JSON variant), `GET /api/study/outcomes`
  (primary = unconfirmed rate among RESOLVED high-risk doses with Wilson 95% CI per arm +
  Newcombe CI for the smart−control difference; secondary = confirmed/on-time/avgDelay/skipped/
  extraExposure/snooze/reminderResponseMinutes; `estimable:false` with explicit reason when an
  arm is empty; `controlExtraSent` computed FROM THE LEDGER; bilingual §18 disclaimers).
- **Task 13 (skip + snooze):** `/api/dose-events/skip` (with skipReason taxonomy: forgot |
  not_needed | doctor | side_effects | other) + `/api/dose-events/snooze` (idempotent via unique
  doseEventId+type+scheduledAt); Dashboard/Toast UI.
- **Task 11-verify:** deferred-items audit — all live checks 200; `.env` truncated a THIRD time
  (handled; fallback chain keeps agents functional).

---

## Stage 12/13 — Site Audit + Cohort + Retrain + Google Wiring (Tasks 21, plan-exec)

**Owner request (2026-09-27):** "افحص كل الموقع وأضف بيانات ومستخدمين ودرّب النماذج وتأكد من
البيانات واربطه بخدمات جوجل."

**Additions:**
- Full site audit (all APIs + pages 200/rendering).
- **Cohort expansion to 15 users / 38 medications:** 12 behavioral personas (night-shift worker,
  student, chronic patient, post-surgery recoverer, weekend-depression profile, improving
  patient, …) via `seed-cohort.ts` + `seed-cohort-2.ts` + demo + 2 real Gmail accounts.
- ML retrained on the cohort (ROC-AUC 0.50 → 0.62); `verify-data` checker built (7 checks →
  later 9); **provider-truth discovery: the z-ai gateway serves GLM (Zhipu AI), not Gemini** —
  docs corrected, `scripts/provider-probe.ts` added.
- Google services wiring: OAuth route + calendar sync endpoints (status/sync) with no-tokens
  graceful paths; `GEMINI_MODEL` env.

---

## Stage 14 — Master Plan Phases p2 (master-plan-exec-…-p2)

**Owner request:** "نفذ الخطة" (execute the plan — MASTER_PLAN.md finally arrived in-message).

**Additions:**
- **Phase 3 (timezone correctness):** `tz.ts` (pure calendar-day math), timezone capture at
  login, settings timezone card, "no retroactive missed-dose invention" rule.
- **Phase 12 (security slices):** BOLA guards on every route, HttpOnly cookie, crypto-random
  OTP, upload validation, `docs/SECURITY_ASSESSMENT.md`.
- **Phase 4 (Analytics 2.0):** 8 KPI cards on DoseEvent + byHour/byMedication/reminderResponse +
  longest streak (`/api/analytics/[userId]` rebuilt).
- **Phase 5 (model metadata):** `ml-artifacts/model_metadata.json` (12 properties, label
  definition, validation protocol, promotion reason).
- **Phase 18 (dedicated docs):** `SECURITY_ASSESSMENT.md`, `API.md`.

---

## Stage 15 — Master Plan Phases p3 (master-plan-exec-…-p3)

**Additions:**
- **Phase 11 (offline sync):** real implementation replacing empty stubs —
  `services/offline/offlineDB.ts` (IndexedDB), `actionQueue.ts` (enqueue/replay/exponential
  backoff/dead-letter), `syncEngine.ts`, `services/network/network.ts` + `networkListener.ts`,
  `NetworkContext` + `SyncStatusBadge`, documented conflict policy (`docs/OFFLINE_SYNC.md`).
- **Phase 8 (AIRouter):** deterministic bilingual server-side router + guaranteed emergency
  escalation line.
- **Phase 15 (measured performance):** 30 instrumented handlers (`/api/metrics`,
  `lib/server/metrics.ts`) + `docs/PERFORMANCE_REPORT.md` with real p50/p95/p99.
- **Phase 13 (accessibility):** text-size control (100/110/125%), `prefers-reduced-motion`,
  descriptive semantics.
- **Phase 6 (explainability):** live-verified bilingual per-dose explanations.

---

## Stage 16 — Keys + Plan-of-Record Document (keys-and-plan-2026-09-29, plan-doc-completion)

**Owner request:** keys supplied; "each agent separate… اكمل واكتب الخطة التي ننفذها".

**Additions:** per-agent chain live verification (`scripts/test-agents.ts` — 6 agents +
translation: status/latency/reply); **`docs/EXECUTION_PLAN.md`** (the executed plan: phases
0→20 with evidence, ML methodology, full session timeline); **project `README.md`**.

---

## Stage 17 — The 55-Section Multi-Agent Architecture (multi-agent-architecture-2026-09-29)

**Owner request:** user pasted a comprehensive 55-section specialized multi-agent AI spec
("4 specialists + Router + Safety Gateway + Vision pipeline + Provider Abstraction + Tool
Permissions + Handoff + Output Validation + Fallback — not 4 chatbots") — "اكمل ونفذها وأضف".

**Additions (the AI core as it exists today):**
- **`ai/providers.ts`** — ModelProvider interface (generate + analyzeImage); groq/gemini/zai
  registry; env-driven chains (§54) with `MEDICAL/MEDICATION/PERSONAL/EMERGENCY/VISION_
  PRIMARY/_SECONDARY/_FALLBACK`; `runProviderChain` keeps "same agent + different provider";
  `GROQ_CHAT_MODEL` env.
- **`ai/agent-registry.ts`** — capabilities matrix (§19, 10 capabilities × 4 agents verbatim);
  per-agent tool permissions (§20-21); handoff targets (§24-26); redirection-marker patterns +
  `detectHandoffTarget`.
- **`ai/tools.ts`** — 6 authorized tools with `assertPermission` BEFORE any data:
  `getMedications`, `checkInteractions`, `getDoseHistory`, `getAdherenceSummary`,
  `getHealthProfile`, `getStoredRiskExplanation` (ML predictions READ-ONLY).
- **`ai/gateway.ts`** — `safetyCheck` (emergency + urgent tiers) → `classifyIntent`
  (incl. PERSONAL_HISTORY tier) → `buildContext` (question-scoped tools) → agent execution via
  the per-agent modules → output validator (handoff QUESTION-FIRST one-hop, escalation
  guarantee, severity, confidence) → AiLog write (data-minimized).
- **`AiLog` Prisma model** (requestId/user/agent/provider/model/intent/severity/fallbackUsed/
  handoff/handoffFrom/safetyResult/toolCalls/latencyMs/success/inputPreview-80-chars/
  answerLength — no full medical text).
- **Routes:** `/api/agents` rewritten as the AI GATEWAY (preferredAgent = hint; safety +
  data-ownership keywords override; structured envelope backward-compatible); 4 direct
  specialist routes wrapped with `wrapDirectAgentCall`; **NEW `/api/agents/vision`** (multipart;
  PNG/JPEG/WebP ≤10MB; medication/report modes; Gemini-vision → z-ai-VLM chain — never
  text-only; injection-guarded structured extraction; medication mode → interaction check under
  medicine-agent tools + specialist explanation; report mode → Medical Knowledge summary
  no-diagnosis; bilingual verify notice + `needs_verification` confidence; 502 honest
  manual-entry fallback); **NEW `/api/ai-monitoring`** (per-agent requests/success/fallback/
  avg+p95 latency/handoffs/safetyBlocks/emergencyPriorities + provider chains + capabilities
  matrix + 40 recent).
- **`scripts/test-agent-suite.ts`** — 12 named tests (TEST-MED-001/002, TEST-PH-001, TEST-ER-001,
  TEST-ROUTER-AR, TEST-URGENT, TEST-SAFETY-PREF, TEST-HANDOFF, TEST-SEC-001/002/003, TEST-MON-001)
  → **25/25 PASS after 3 real fixes:** (a) handoffFrom recorded when safety overrides
  preference, (b) personal-history data-ownership phrases router-correct the preference,
  (c) handoff target selection made QUESTION-FIRST (a redirect mentioning "urgent situations"
  was sending an aspirin question to emergency).
- **Vision E2E:** generated a Metformin 500mg package image → extraction
  `{"drugName":"METFORMIN","strength":"500 mg","form":"tablets"}` + specialist explanation +
  verify notice.
- **Frontend:** `aiMonitoring.jsx` page (all sections, window selector, EN↔AR, mobile); agents
  page upgraded — 6 quick-action launcher (4 specialist picks as preferredAgent hints + Analyze
  Report nav + Upload Image), specialist cards post through the GATEWAY, image-upload modal
  (preview + mode radios + honest amber notice), vision result panel in chat (mode badge +
  extracted drug chip + warnings + verify notice), severity/handoff badges.
- **Data-drift incident reconciled honestly:** 285 orphan RiskPredictions cleaned
  (`repair-data.ts` R0 + R1–R3), persona robustness tweaks, both cohorts re-seeded, retrained →
  verify-data 9/9; **`docs/AI_ARCHITECTURE.md`** written (spec-to-code map, strict-rules
  enforcement table, env config, honest not-implemented list).
- Turbopack lesson #3 documented (stale Prisma client after db push).

---

## Stage 18 — Full-Site Test (full-site-test-2026-09-29)

**Owner request:** "راع المحدات السابقة والاضافات التي تم اضافتها وقم بعمل اختبار لكل الموقع"
(respect previous constraints + additions; test the ENTIRE site).

**Additions:**
- **`scripts/test-full-site.ts` — 56 checks over 12 groups** (health/readyz/metrics/languages;
  auth incl. wrong-pw/unauthenticated/signup-validation/OTP-4xx; analytics/intelligence/streak/
  dose-events/notifications/calendar; medications incl. numeric-frequency coercion hardening +
  bulk; reminder-engine tick + mark-taken; reports incl. PDF + multipart analyze + chat by
  reportId; AI Gateway incl. Arabic emergency routing + 4 specialists + monitoring + vision-4xx;
  translate; ml/status; study; preferences; BOLA cross-user). Self-cleaning. **56/56 PASS.**
- **3 real bugs found & fixed:**
  1. `agents/personal-health/route.ts` — missing `wrapDirectAgentCall` import → 500 on every
     direct personal-health call.
  2. `auth/signup/route.ts` — NO input validation (empty name/email/password created junk user
     rows with 200!) → added name/email-regex/password≥8 validation with bilingual 400.
  3. `medicine/add/route.ts` — frequency as number → raw Prisma 500 → defensive coercion.
- **Degraded-mode UX:** bilingual friendly message at both gateway return points when all
  providers are exhausted (emergency keeps its rule-based escalation line).
- **Data incident handled:** accidentally deleted the demo user's original Vitamin D3 → restored
  with the SAME original id + 11 DoseEvents re-linked + adherenceHistory rebuilt → verify-data
  9/9 again.
- Browser E2E: all 17 routes EN/AR, RTL, mobile 390px zero overflow, live WebSocket, image
  upload through the UI, PDF generation, language switch, logout/login.

---

## Stage 19 — Medication Lifecycle Completion (med-crud-2026-09-29)

**Owner request:** "قم بعمل اضافات وتعديلات اشياء منطقية للمشروع متل حدف دواء والي اخره"
(add logical operations like medication deletion, etc.).

**Additions:**
- `POST /api/medicine/delete` — cascading delete (DoseEvents → SmartReminders → RiskPredictions
  → medication) with per-table removal counts in the response.
- `POST /api/medicine/update` — partial edit; interaction shield on rename (409 block-major);
  Arabic description re-translation; rescheduling of future doses preserving confirmed history.
- `POST /api/medicine/list` — all medications + localized + `scheduledToday` flag.
- **`EditMedicationModal.jsx`** (bilingual RTL); Today/All toggle on the dashboard; edit/delete
  buttons on every card; irreversible-delete confirmation modal; toasts with cascade counts.
- DELETE/UPDATE deliberately excluded from the offline action queue.
- **`scripts/test-med-crud.ts` — 40/40 PASS** (401/BOLA/validation/shield/reschedule-in-DB/
  cascade-no-orphans); cleaned 88 orphan RiskPredictions (repair-data R0) → verify-data 9/9.

---

## Stage 20 — The Master Audit (master-audit-2026-09-29 + audit-docs-12)

**Owner request:** user pasted the consolidated MASTER AUDIT (33 parts, P0-01…P2-73, phases 0-5,
final production gate + golden architectural rule).

**Additions (73 findings implemented):**
- **P0-07** account-state check on EVERY authenticated request (`requireSelf`: active |
  disabled | suspended | deleted).
- **P0-08** session versioning — `User.tokenVersion` bump invalidates every previously issued
  JWT (password change, security event, logout-all-devices, admin disable).
- **P0-12** backup codes: crypto-random, stored as SHA-256 hashes, plaintext shown ONCE.
- **P0-13** resend-otp per-account 60s cooldown.
- **Rate limits:** sliding windows on login/signup/verify-otp/resend-otp/google (429 +
  `Retry-After`).
- **Socket isolation:** token from `handshake.auth` only; rooms from verified identity;
  foreign-join rejected + logged.
- **Safe error contracts:** unified `INTERNAL_ERROR` in auth — never raw exception text.
- **Logout endpoint:** `POST /api/auth/logout` (+ `{allDevices:true}` full revocation).
- **Model modernization:** deprecated `llama-3.3-70b`/`llama-4-scout` → `openai/gpt-oss-120b`
  (answers) / `openai/gpt-oss-20b` (summaries) with per-agent env overrides
  (`MEDICAL_CHAT_MODEL`, `MEDICATION_*`, `PERSONAL_*`, `EMERGENCY_*`, `REPORT_CHAT_MODEL`,
  `GROQ_CHAT_MODEL`).
- **Independent output-verification gateway** + timezone-appropriate emergency numbers.
- **Report-analysis prompts rewritten:** no prescriptions / no diagnosis from a single lab
  value + prompt-injection defense (document content wrapped as UNTRUSTED DATA); `N/A` instead
  of fake 100% when no doses.
- **Provider reliability:** per-call timeout (45s text / 90s vision) + in-memory circuit breaker
  (3 failures → 60s open → half-open probe) surfaced in `/api/ai-monitoring` (providerHealth).
- **`getMedications` tool scoping fixed** (userId-scoped).
- **`scripts/test-security.ts`** — 22/22 at the time (later 23/23 with F-18).
- 130-check regression + browser E2E; docs updated honestly (audit-docs-12).

---

## Stage 21 — v5 Review Implementation (Tasks 2-a, 2-b, 2-c, 3-a, v5-final)

**Additions:**

**2-a — Conversation 2.0 backend:**
- **`lib/server/conversations.ts`** — `getOrCreateConversation` (ownership on the WHERE clause:
  `id+userId+active`; foreign/archived ids silently ignored → new thread), `loadHistory` (last
  16 turns), `appendExchange` (title = first 60 chars, lazy LLM-free summary folding: >60
  stored messages → oldest half joined into `summary`, hard cap 200 stored messages),
  `getSummaryForPrompt`, `listConversations` (≤50), soft-archive. 8000-char/message
  sanitization. (Removed the P0 defect: module-level `Map<userId, ConversationSummaryMemory>`
  → cross-conversation contamination + lost on restart.)
- **`/api/agents/conversations`** (GET ?agent= list / GET ?id= detail / DELETE ?id=
  soft-archive) + `conversationId` param threaded through `/api/agents` and the 4 direct routes.
- **24h AI response cache** (LRU 200; only static medical/medication knowledge with zero
  personal-data tools; `cached:true` + provider "cache" in the response).
- **Daily per-user/per-agent budget** — defaults 40/user/agent/day + 5000 global/agent/day
  (`AI_DAILY_AGENT_REQUESTS` / `AI_GLOBAL_AGENT_DAILY`); emergency exempt from the per-user cap;
  429 `AI_BUDGET_EXCEEDED` contract with `limit` details.
- **`scripts/test-conversations-unit.ts` (32/32)** + **`scripts/test-conversations.ts` (44/44)**
  incl. full BOLA matrix for a second signup user.

**2-b — Feedback + consent + research APIs:**
- **`/api/agents/feedback`** — POST rating (helpful|unhelpful|unsafe) per agent with aiLogId
  upsert semantics (one vote per answer, changeable), comment ≤500 chars, 30/10min rate limit.
- **`/api/study/consent`** — GET/POST/DELETE lifecycle (version from `STUDY_CONSENT_VERSION`,
  default 1.0.0; idempotent revoke).
- **`study.ts` → `getEffectiveStudyArm`** (assigned arm only when ACTIVE consent exists, else
  control with reason "no-consent").
- **`/api/study/export`** — now includes ONLY consented participants + consent provenance.
- **`/api/research/overview`** — de-identified aggregates (participants/consent, doses 30d by
  all five states, risk buckets + model availability, 6-check data quality, per-agent AI stats
  + feedback).
- **`/api/ai-monitoring`** — additive feedback aggregates section.
- **`scripts/test-research.ts` — 48/48** (incl. recursive de-identification assertion).

**2-c — Notification localization + glossary:**
- **41-key bilingual template map (82 renderings)** covering EVERY user-facing scheduler
  string: before/onTime/after personalized titles+messages (incl. the 3-variant ≥90%
  encouragement pool), basic fallbacks, boot test notification, EXTRA escalation + reasons,
  snooze confirmation. `renderNotif()` per language, degrades to English → raw med name.
- `timeStringForLanguage()` (tz semantics preserved; Arabic "3:52 م" with Latin digits via
  `ar-u-nu-latn`); `formatRemindWindow()` with proper Arabic noun agreement.
- **2 latent bugs found & fixed:** (1) personalized-notification generator queried REMOVED
  Conversation fields → every "personalized" notification silently fell back to basic strings
  since the Conversation 2.0 migration; (2) snooze route had `await` in a non-async function →
  could never compile.
- **Glossary upgrade:** `medical-terminology.ts` → `Record<string, {ar; context?; approved?;
  reviewer?}>`; 69 existing entries enriched with context notes + 38 high-frequency terms added
  (amlodipine/losartan/simvastatin/metoprolol/warfarin/clopidogrel/hydrochlorothiazide/
  furosemide/rosuvastatin/pantoprazole/salbutamol/levothyroxine/prednisone/gabapentin;
  palpitations/shortness of breath/chest pain/fatigue/vomiting/diarrhea/constipation/insomnia/
  cough/sore throat/blurred vision/swelling; hemoglobin/HbA1c/cholesterol/triglycerides/
  creatinin/white blood cells/platelets/liver enzymes; dose/missed dose/medication adherence/
  over-the-counter/chronic disease) = **107 terms**. Honesty: `approved:true` ONLY on the 24
  pure INN transliterations, all still `reviewer:"pending-qualified-reviewer"`.
- **`scripts/gen-glossary.ts`** + generated **`docs/GLOSSARY.md`** (107-row table with a
  bilingual review-workflow header).
- **`scripts/test-notif-l10n.ts` — 48/48.**

**3-a — Frontend (conversations + feedback + research UI):**
- `agents.jsx` — per-agent thread panel (desktop sidebar / mobile drawer), "بدء محادثة جديدة"
  button, thread list (title/messageCount/relative time), load history, delete-with-confirm,
  cached-answer badge, historyUsed indicator, budget-429 through the localized error map,
  feedback buttons (ThumbsUp/ThumbsDown/AlertTriangle, 44px targets, aria-labels, per-logId
  vote tracking, ⚠️ one-line bilingual confirm).
- **`research.jsx` (NEW page)** — de-identified research dashboard (stat cards, doses CSS bars
  by status, 5-bucket risk bars, 6-check data-quality checklist, per-agent AI table with
  feedback, loading skeleton + error retry).
- `Settings.jsx` — "المشاركة في البحث" consent card (state display, grant/revoke with bilingual
  inline confirm, honest revocation note).
- `App.jsx`/`AppSidebar.jsx` — /research route + bilingual nav entry.
- `src/lib/i18n.ts` — **ERROR_MESSAGES code→{ar,en} map** (AI_BUDGET_EXCEEDED, RATE_LIMITED,
  VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, SESSION_INVALIDATED, ACCOUNT_DISABLED,
  INTERNAL_ERROR, MODEL_UNAVAILABLE, SAFETY_BLOCKED…) + `errorMessage()` helper.
- `NotificationToast.jsx` — `dir="auto"` (mixed Arabic sentence + Latin drug name renders
  correctly in both directions).

---

## Stage 22 — Master Review 100 + Fix Wave (MR-0 … MR-FINAL)

**Owner request:** *"راجع كل المحادثات وتأكد أنه تم إضافة كل شيء، وتأكد من إضافة جزء الـengines
الخاص بالـagents حتى يعرف ما هي الـagents المضافة، وإذا هناك مشاكل أو إضافات لم تتم إضافتها،
قسّمه على 20 agents و100 مهمة، وتأكد من كل شيء."*

**Additions:**
- **MR-0 (pre-review fix, explicit owner requirement):** the medication agent now ALWAYS knows
  the caller's added medications — context injection unconditional (gateway + direct routes),
  proactive interaction screen at 2+ meds, "none added yet" otherwise.
- **20 review agents × 5 tasks = 100 tasks** executed (MR-1 auth/security · MR-2 medicine CRUD ·
  MR-3 medication agent+context ⭐ · MR-4 medical agent · MR-5 emergency · MR-6 personal health ·
  MR-7 gateway · MR-8 providers/separation · MR-9 vision · MR-10 reports · MR-11 ML · MR-12
  reminder engine · MR-13 dose events · MR-14 analytics/intelligence · MR-15 study/consent ·
  MR-16 conversations/feedback/budget · MR-17 i18n/RTL · MR-18 pages · MR-19 offline/socket ·
  MR-20 docs/tests/data). Outcome: **74 ✅ / 26 ⚠️ / 1 ❌.**
- **MR-FINAL — 18 centralized fixes:**

| # | Fix (exact content) |
|---|---------------------|
| F-01 | Medicine-agent medication context UNCONDITIONAL (gateway + direct, proactive interaction screen, "none added yet") — live-proven with a generic Arabic question answering «لديك باراسيتامول (Paracetamol) 500مجم في قائمة أدويتك…» |
| F-02 | `skip` route compile fix (`await` inside non-async `resolveUserId` — never compiled since creation; a live probe poisoned Turbopack state and the entire dev server 500'd — fixed + clean restart) |
| F-03 | Real random `JWT_SECRET` in `.env` + socket-service `.env` (chmod 600); old sessions invalidated |
| F-04 | 6 `getAuthUser` routes → `requireSelf` (preferences, preferences/reset, check-interactions, calendar/sync, calendar/status, health) |
| F-05 | 11 raw `err.message` leaks → safe contracts + console.error (add/delete/update/bulk/streak/notification-today/agents-reports/health×2/check-interactions) |
| F-06 | G-01 closed: `wrapDirectAgentCall` now runs `checkAiBudget`/`consumeAiBudget` (same 429 contract; emergency keeps per-user exemption) |
| F-07 | EXTRA escalation consent-gated: engine switched `getStudyArm` → `getEffectiveStudyArm` (smart arm without ACTIVE consent = control) |
| F-08 | Orphan prevention: `user-timezone.ts` + `test-full-site.ts` delete RiskPredictions (+ logged SmartReminders in tests) with their future DoseEvents |
| F-09 | `repair-data` run: R0 deleted 84 orphan RiskPredictions, R3 rebuilt adherenceHistory (38 meds) → verify-data ALL 9 (was 7/9) |
| F-10 | `medicine/add` validates `pillName` up front (empty → 400; missing → 400 instead of raw-Prisma 500) |
| F-11 | `medicine/bulk` screens interactions per item (major blocks the item with guidance; moderate/minor returned as `interactionWarnings`; intra-batch screening included) |
| F-12 | Adherence streak: a today-bucket with zero resolved doses is SKIPPED instead of breaking the streak (morning collapse fixed) |
| F-13 | Socket `/emit` bridge requires HMAC-SHA256 over the raw body (timing-safe, shared JWT_SECRET, header `x-emit-signature`); reminder-engine signs its calls |
| F-14 | Escalation-line skip-regex requires a concrete number near call/dial (bare «رقم الطوارئ» no longer suppresses the locale number) |
| F-15 | Arabic emergency keywords extended (ألم شديد/حاد في الصدر، ضيق في التنفس) |
| F-16 | Prompt pinning: medicine grounding line (never invent the caller's regimen), personal-health ML read-only ban, medical four prohibitions (bilingual) |
| F-17 | healthz `geminiViaZai` → `zaiGlm` (honest: the gateway serves GLM, not Gemini) |
| F-18 | test-security signs its bridge probe + NEW check "emit bridge rejects UNSIGNED call" → 23/23 |

- **Final battery (all green, sequential):** verify-data 9/9 · lint 0/0 · med-crud 40/40 ·
  agent-suite 25/25 · security 23/23 · notif-l10n 48/48 · conversations-unit 32/32 ·
  conversations 44/44 · research 48/48 · e2e-golden-path 34/34 · full-site 56/56 → **350 test
  checks + 9 data checks, 0 failures.**
- **Docs sync (12 stale claims resolved):** MASTER_REVIEW_100 §3 final results; EXECUTION_PLAN
  §3 rewritten for the v5 per-agent architecture; README corrected (languages EN/AR, model
  registry, 350-check battery); SECURITY_ASSESSMENT banner + §5.5; STUDY_PROTOCOL §6 export
  columns (19); API.md v5 endpoint table.

---

## Stages 23–24 — The Documentation Series (Tasks 22, 23 — the current work)

- **Task 22:** `docs/CHANGES.md` — English chronological changelog of ALL additions/modifications.
- **Task 23:** `docs/DETAILED_ADDITIONS.md` — size-ordered inventory with measured counts
  (62 routes, 14 models, 1,097 t() sites, LOC by area…).
- **Task 24 (this file):** `docs/FULL_RECORD.md` — the maximal line-by-line record.

---

# PART II — THE SIZE-ORDERED INVENTORY (largest → smallest, with full granularity)

---

## II.1 The Platform Foundation (underpins everything — ~35,134 LOC total)

**Stack replacement table:**

| Layer | Original repo | This project |
|-------|---------------|--------------|
| Client | React 19 + Vite SPA | Same code, hosted in Next.js 16 `/` via HashRouter, `ssr:false` |
| Server | Express (12 route files) | 62 Next.js Route Handler files |
| Database | MongoDB + Mongoose (7 models) | Prisma + SQLite (14 models) |
| Realtime | in-process Socket.IO | standalone mini-service :3003 + emit bridge :3004 |
| LLM | Groq/Gemini direct | per-agent chains Groq → Gemini → z-ai/GLM |
| PDF | apitememplate.io | pdfkit + pdf-parse (+ arabic-persian-reshaper) |
| Password | bcrypt | scrypt |
| Email OTP | SMTP | sandbox demo OTP (shown in a marked banner) |

**All 14 Prisma models with their fields:**

| Model | Fields (beyond ids/timestamps) |
|-------|-------------------------------|
| `User` | name, email(uniq), password?, googleId(uniq), googleTokens(Json), timeZone, lastCalendarSync, calendarSyncEnabled, isVerified, **status** (active|disabled|suspended|deleted — P0-07), **tokenVersion** (P0-08), otpCode, otpExpiresAt, otpRetryCount, otpResendAt (P0-13), backupCodes(Json, SHA-256 — P0-12), preferredLanguage, autoTranslateAll, showReadabilityScores, targetReadingLevel |
| `Medication` | userId, pillName, pillDescription, dosageDays(Json), dosageTimes(Json), dosageAmount, frequency, startDate, endDate, originalInstructions, translatedAr, adherenceHistory(Json), doctorName, prescriptionId, notes |
| `DoseEvent` | userId, medicationId, scheduledAt, actualAt, **status** (pending|taken|delayed|missed|skipped), delayMinutes, **skipReason** (forgot|not_needed|doctor|side_effects|other), riskScore, riskLevel, modelVersion, source, slotTime · unique(medicationId,scheduledAt) |
| `SmartReminder` | userId, doseEventId, **type** (before|onTime|after|extra|snooze), scheduledAt, sentAt, status, **mode** (shadow|live), riskScore, riskLevel, payload(Json) · unique(doseEventId,type,scheduledAt) |
| `RiskPrediction` | userId, doseEventId, modelVersion, riskScore, riskLevel, features(Json), explanation(Json, signed bilingual contributions), mode |
| `ModelArtifact` | modelType (baseline|logistic-regression|random-forest|gradient-boosting), version, weights(Json), metrics(Json), trainRows, testRows, isActive · unique(modelType,version) |
| `StudyAssignment` | userId(uniq), arm (control|smart), reason (auto-balanced|operator) |
| `StudyConsent` | userId(uniq), version, grantedAt, revokedAt |
| `Report` | userId, filename, reportText, analysis, translatedAnalysis(Json), originalLanguage, readabilityScore(Json) |
| `HealthProfile` | user(uniq), age, gender, height, weight, bloodGroup, medicalConditions(Json), allergies(Json), medications(Json), emergencyContact(Json), lastCheckup |
| `Conversation` (2.0) | userId, agent, title, messages(Json), summary, language, messageCount, promptVersion, modelVersion, provider, active(soft archive) · indexes(userId,agent,active)+(userId,updatedAt) |
| `AiLog` | requestId, user?, agent (router|medical|medicine|personal-health|emergency|vision-medication|vision-report), provider (groq|gemini|zai-glm), model, intent, severity, fallbackUsed, handoff, handoffFrom, safetyResult, toolCalls(Json), latencyMs, success, inputPreview(80 chars), answerLength |
| `AiFeedback` | userId, agent (+router), rating (helpful|unhelpful|unsafe), comment, aiLogId?, conversationId? |
| `DailyNotification` | userId, date, dayName, notifications(Json) · unique(userId,date) |

**All 62 API endpoints:**

| Group | Endpoints |
|-------|-----------|
| auth (6) | POST signup · POST login · POST verify-otp · POST resend-otp · POST logout (allDevices) · POST google |
| medicine (8) | POST add · POST update · POST delete · POST list · POST today · POST status · POST bulk · POST check-interactions |
| agents (10) | POST / (gateway) · POST chat · POST medical · POST medicine · POST personal-health · POST emergency · POST vision (multipart) · POST feedback · GET conversations (list/detail/DELETE) · POST reports |
| report (5) | POST / (PDF) · POST analyze (multipart) · POST chat · GET [id]/translate/[language] · GET [id]/readability |
| study (5) | GET status · POST assign (operator) · GET outcomes · GET export (CSV/JSON) · GET/POST/DELETE consent |
| translate (3) | POST / · POST batch · GET supported |
| preferences (3) | GET/POST / · POST timezone · POST reset |
| dose-events (3) | GET/POST / · POST skip · POST snooze |
| languages (2) | GET user · GET supported |
| calendar (2) | GET status · POST sync |
| ml (2) | POST train · GET status |
| notification (2) | GET today · POST regular-notify |
| singles (11) | GET healthz · GET readyz · GET health · GET metrics · GET ai-monitoring · GET analytics/[userId] · GET intelligence/overview · GET streak · POST reminder-engine/tick · GET research/overview · GET oauth/login |

---

## II.2 The Application UI (12,146 LOC — 18 pages, 15 components, 6 contexts)

**Pages (18):** landingPage · Login · Signup (3-step OTP) · OAuthCallback · Dashboard (Today/All
medications toggle, edit/delete on every card) · addMedication (single + bulk tabs) · agents
(6-way launcher, gateway chat, threads, feedback, image upload) · Reports · ReportAnalysis ·
ReportChat · Analytics (8 KPIs + heatmap + charts) · **intelligence** (48h forecast +
explainability + engine/retrain controls) · **aiMonitoring** (per-agent stats, capabilities
matrix, provider chains) · **research** (de-identified study dashboard) · notifications ·
Settings (timezone, text size, consent card) · HealthProfile · ConnectCalendar.

**Components (15):** AppSidebar · Navbar · Button · Loader · OTPInput · ProtectedRoute ·
LanguageSwitcher · LanguageSettings · TranslationBadge · ReadabilityIndicator ·
InteractionWarning · BulkMedicineInput · NotificationToast (dir=auto) · SyncStatusBadge ·
EditMedicationModal.

**Contexts (6):** languageContext · medicationContext · notificationContext · socketContext ·
calendarSyncContext · NetworkContext.

**Design system ("Rhythm" Soft-Dark v4):** light 280px sidebar + slate canvas + white glass
cards + mint hero; Playfair Display + Amiri serif headings; IBM Plex Sans Arabic body; emerald
waves; full RTL logical properties; text-size 100/110/125%; `prefers-reduced-motion`; mobile
bottom nav with safe-area; sticky footer; 44px touch targets.

---

## II.3 The Multi-Agent AI System (~3,100 LOC)

**Registry (single source of truth, code-enforced):** 4 registered agents — medical (0 tools /
0 scopes), medicine (getMedications + checkInteractions / medications + schedule),
personal-health (all 5 data tools / dose_history + medications + health_profile +
ml_risk_explanations), emergency (getMedications + checkInteractions / medications).
Capabilities matrix: 10 capabilities × 4 agents (general knowledge, medication info, drug
interaction, dose schedule, adherence history, health profile, lab explanation, triage, change
medication=none, diagnose=none). Handoff graph: medical→{medicine,emergency,personal-health},
medicine→{emergency,personal-health,medical}, personal-health→{medicine,emergency,medical},
emergency→∅. 13 bilingual handoff-marker regexes + `detectHandoffTarget`.

**Gateway pipeline:** safety router (55 bilingual emergency keywords — 28 EN + 27 AR — + env extension) →
intent classifier (incl. PERSONAL_HISTORY data-ownership tier) → context builder
(registry-authorized tools only; medication list ALWAYS for the medicine agent) → per-agent
execution → output verification (escalation regex requiring a real number, grounding, severity,
confidence) → one-flip handoff → data-minimized AiLog → 24h cache eligibility → daily budget.

**Per-agent modules (NO shared llm.ts):**

| Module | Chain (env prefix) | Model override |
|--------|--------------------|----------------|
| medical-model.ts | groq → gemini → zai (`MEDICAL_*`) | `MEDICAL_CHAT_MODEL` |
| emergency-model.ts | groq → gemini → zai (`EMERGENCY_*`) | `EMERGENCY_CHAT_MODEL` |
| medicine-model.ts | groq → gemini → zai (`MEDICATION_*`) | `MEDICATION_CHAT_MODEL` |
| personal-health-model.ts | groq → gemini → zai (`PERSONAL_*`) | `PERSONAL_CHAT_MODEL` |
| report-analysis.ts | groq → zai (own hard chain) | `REPORT_CHAT_MODEL` |
| translation.ts | gemini → zai (private instance) | — |
| ai/providers.ts | groq → gemini → zai + circuit breaker | `GROQ_CHAT_MODEL` |

**Conversation 2.0:** DB threads per (user, agent, conversation); 16-turn window + rolling
textual summary (>60 messages fold, cap 200 stored, 8000 chars/message); soft archive; threads
survive restarts.

**Vision line:** PNG/JPEG/WebP ≤10MB; medication mode (extraction + interaction check +
specialist explanation) / report mode (summary, no diagnosis); injection-guarded structured
extraction; bilingual mandatory verify notice + `needs_verification`; 502 honest manual-entry
fallback; never text-only (vision model or nothing).

**Monitoring:** `/api/ai-monitoring` — per-agent requests/success/fallback/avg+p95 latency/
handoffs/safetyBlocks/emergencyPriorities + feedback aggregates + provider chains + capabilities
matrix + 40 recent logs.

---

## II.4 The ML Pipeline & Research Platform (~1,500 LOC)

- **12 leakage-free features** per dose; honest label = "not confirmed on time"
  (delayed|missed within the 120-min grace window).
- **Four candidates:** rule baseline · standardized class-balanced L2 LR · Random Forest
  (60 trees, depth 4, seeded sqrt(d) feature subsample, Laplace leaves, Gini importance) ·
  Gradient Boosting (60 rounds, depth-2, lr 0.1, SSE importance) — all with `mulberry32`
  seeded determinism (byte-identical metrics across runs).
- **Temporal 70/30 split only**; metrics: tie-corrected ROC-AUC, PR-AUC, Brier, logLoss,
  10-bin calibration, confusion — accuracy never the judge.
- **Evidence-based promotion** + one versioned artifact per candidate (exactly one isActive)
  + small-dataset honesty note when resolvedEvents < 200.
- **Explainability:** signed per-dose bilingual contributions (baseline/LR) or global
  importance (RF/GB), persisted with every prediction.
- **ReminderEngine:** 60s tick + boot recovery; before/onTime/after + EXTRA (15-min post-slot,
  high-risk only, consent-gated, honest data-derived reason); shadow default; idempotent
  upserts; >15-min overdue skipped; HMAC-signed socket delivery.
- **Study:** balanced arms (control = normal reminders, smart = +EXTRA); operator assignment;
  consent lifecycle; **export CSV** (pseudonymized by construction — sha16 participant codes,
  M01… medication codes, 19 columns, RFC-4180, consent-filtered, provenance metadata);
  **outcomes** (primary = high-risk unconfirmed rate, Wilson 95% per arm + Newcombe method-10
  CI for the difference; `estimable:false` when an arm is empty; ledger-computed integrity).

---

## II.5 The Bilingual Layer (1,097 t() sites + everything below)

- Bilingual dictionaries + `t(key, vars)`; RTL via `<html dir>` + logical properties; language
  switcher in 3 locations; `languages/user` + `languages/supported`.
- **107-term medical glossary** (69 enriched + 38 new; 24 INN transliterations approvable, all
  pending qualified review) + generated `docs/GLOSSARY.md` + `gen-glossary.ts`.
- **41 notification templates × 2 languages = 82 renderings** (incl. 3-variant ≥90%
  encouragement pool; med names pass through untranslated; Arabic times "3:52 م" with Latin
  digits; noun-agreeing durations).
- **ERROR_MESSAGES closed code→{ar,en} map** (14 codes — the closed set in `src/lib/i18n.ts`;
  11 was the count of raw-message leaks fixed by F-05, a different thing) + `errorMessage()` helper.
- Arabic PDF reports (reshaper + embedded FreeSerif); Arabic agent replies; bilingual agent
  forbidden statements; bilingual degraded-mode and budget messages.

---

## II.6 Security Layer

`requireSelf` chain (token → exists → active → tokenVersion → BOLA) on every protected route ·
rate limits (login/signup/verify/resend/google sliding windows + 429/Retry-After; OTP 60s
cooldown; feedback 30/10min; consent 10/10min; report upload 10/10min) · BOLA ownership on all
resources · HMAC-SHA256 signed emit bridge (timing-safe) · socket rooms from verified identity
· scrypt + SHA-256 backup codes + crypto-random OTP · safe error contracts (11 leaks fixed) ·
PDF magic-byte check + UNTRUSTED-DATA wrapping · real random JWT_SECRET (0600).

---

## II.7 Subsystems (Reports · Medicine CRUD · Offline · Analytics · Socket · Observability)

- **Reports:** analyze (multipart + injection defense) → grounded chat (citations +
  NOT_FOUND) → bilingual PDF → per-report translation → readability (Flesch-Kincaid).
- **Medicine CRUD:** add (validation + interaction shield + scheduling + translation) · update
  (partial + shield on rename + reschedule preserving history) · delete (cascade with counts) ·
  list (localized + scheduledToday) · today · status (dual-write to DoseEvent) · bulk (per-item
  + intra-batch interaction screening) · check-interactions.
- **Offline:** IndexedDB queue → replay → exponential backoff → dead-letter → status badge;
  DELETE/UPDATE excluded by design; documented conflict policy.
- **Analytics:** 8 KPIs + byHour/byMedication/reminderResponse + longest streak; intelligence:
  48h forecast + explanations + calibration; timezone-correct (pure calendar-day math).
- **Socket:** :3003 service (JWT handshake, per-user rooms) + :3004 HMAC-signed bridge; client
  lifecycle with session.
- **Observability:** healthz (honest zaiGlm) · readyz · metrics (30 instrumented handlers,
  p50/p95/p99) · PERFORMANCE_REPORT with measured numbers only.

---

## II.8 Tests & Scripts (20 scripts — 19 TS + 1 shell, 5,059 lines, 350 checks)

| Script | Checks |
|--------|--------|
| test-full-site.ts | 56 (12 groups, self-cleaning) |
| test-med-crud.ts | 40 |
| test-research.ts | 48 |
| test-notif-l10n.ts | 48 |
| test-conversations.ts | 44 |
| test-e2e-golden-path.ts | 34 |
| test-conversations-unit.ts | 32 |
| test-agent-suite.ts | 25 (12 named TEST-* cases) |
| test-security.ts | 23 (incl. unsigned-bridge rejection) |
| test-agents.ts | ops probe (pre-gateway direct-agent smoke — kept as an operations tool) |
| verify-data.ts | 9 data checks |
| state-snapshot / provider-probe / seed-demo / seed-cohort / seed-cohort-2 / repair-data / modernize-agents / gen-glossary / launch-services.sh | ops |

---

## II.9 Documentation (18 files incl. VERIFICATION_REPORT + README + worklog)

EXECUTION_PLAN · MASTER_REVIEW_100 · AI_ARCHITECTURE · SECURITY_ASSESSMENT · API · ML_DESIGN ·
STUDY_PROTOCOL · ADHERENCE_PLATFORM · PERFORMANCE_REPORT · OFFLINE_SYNC · BASELINE_REPORT ·
BUG_REGISTER (13 entries) · LIMITATIONS · GLOSSARY · CHANGES · DETAILED_ADDITIONS ·
FULL_RECORD (this file) · VERIFICATION_REPORT (the 2026-10-09 audit that re-proved every
claim) + README + worklog (1,607+ lines, 73 unique task entries).

---

## II.10 Smallest Additions (data assets & utilities)

- **55 bilingual emergency keywords** (28 EN + 27 AR + `EMERGENCY_KEYWORDS_EXTRA` env).
- **Drug-interaction dataset:** 26 severity entries / 18 curated core pairs (RxNorm + ONCHigh
  layers + static fallback), bilingual descriptions.
- **Timezone-appropriate emergency numbers** (101/911/112 by region).
- **`tz.ts`** pure calendar-day math; **`user-timezone.ts`** with orphan prevention;
  **`serialize.ts`** Mongo-shaped API objects (incl. `_id` alias); **`readability.ts`** (en/es/hi);
  **`language-config.ts`**; **`medicine-parser.ts`**; **`study-stats.ts`** (Wilson/Newcombe).
- Demo fixtures: demo account + 12 behavioral personas + deterministic seeds (mulberry32).
- Fonts (`assets/fonts/FreeSerif*.ttf`), logo, robots.txt, Caddyfile, runtime probes
  (`tests/*.sh`), `agent-ctx/` subagent docs, verification screenshot archives.

---

## II.11 Every Bug Ever Found & Fixed (the complete register)

| Class | Count | Items |
|-------|-------|-------|
| Original-repo bugs (Stage 2) | 8 | unmounted streak route · apiClient no-parse/no-auth · bulk iteration · translation object leak · import case · contexts not refreshing · landing/OTP flow · parser .success/.failed |
| Prototype-stage fixes (Stage 1) | 5 | retrieval threshold · seed probabilities · setState-in-effect · ESLint ignores · Prisma log noise |
| E2E stabilization (Stage 3) | 4 | dead Mark Taken · agents mobile layout · socket lifecycle · double submission |
| Gateway suite fixes (Stage 17) | 3 | handoffFrom on safety override · personal-history ownership routing · QUESTION-FIRST handoff |
| Full-site suite fixes (Stage 18) | 3 | personal-health missing import · signup validation · numeric frequency |
| Latent v5 bugs (Stage 21) | 2 | personalized-notification dead query · snooze await-in-non-async |
| Master Review fixes | 18 | F-01 … F-18 (full table in Stage 22) |
| Documented lessons (BUG_REGISTER) | 13 | incl. Turbopack module fragmentation ×2 (globalThis fix), stale Prisma client after db push, .env lost ×7, ANSI byte-level checking, server restart after engine edits |

---

*Research-honesty contract: every number above was measured in the repository or reproduced by
the 350-check battery on 2026-10-01; the active model's metrics are from the stored
ModelArtifact; no synthetic result is presented as clinical evidence; deferred items (owner key
re-supply, unauthenticated public PDFs, IRB approval, pharmacist glossary review) are declared
in LIMITATIONS.md / CHANGES.md Part G.*
