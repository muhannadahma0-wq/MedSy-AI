# REQUIREMENT_TRACEABILITY.md — Plan Requirement → Code → Test (migrated stack)

**Owner:** Agent 6 · **Scope:** the owner's migration plan §1.1 objectives and §8 preservation requirements, traced to the migrated implementation and its verifying evidence.

| Requirement (plan) | Implementation (migrated) | Verification | Result |
|---|---|---|---|
| Independent React+Vite frontend | `migration/client` (build 2,351 modules; BrowserRouter restored ADR-04) | vite build + agent-browser E2E (Task 28) | ✅ |
| Express API without Next runtime | `migration/server` :3005 (ADR-02 shim, 70 bindings/62 routes) | full battery on :3005 (Task 32) | ✅ |
| PostgreSQL via Prisma, data migrated + reconciled | PG 17.10 :5433; backfill IDs preserved; 5-family reconcile | verify:all; DATA_MIGRATION_REPORT (Task 30) | ✅ |
| Auth/authorization preserved | verbatim jwt.ts/requireSelf through shim | test-security 23/23 on :3005; cookie-only 200; BOLA 403 | ✅ |
| Medication CRUD + interactions | verbatim medicine routes | test-med-crud 40/40 on :3005 | ✅ |
| Dose events, skip/snooze, streak | verbatim dose-events/streak routes + adherence-engine | golden-path 34/34; full-site 56/56 on :3005 | ✅ |
| 4 specialist agents + registry + tools + gateway | verbatim ai/* modules | test-agent-suite 25/25; emergency routing + tool scope proven (Task 31) | ✅ |
| Provider chains, timeouts, breaker, degraded mode | verbatim providers.ts | agent-suite; breaker observed (groq/gemini half-open, zai closed) in ai-monitoring | ✅ |
| Vision pipeline + upload validation | verbatim vision route (multipart via raw-body shim) | 415/400 baseline-parity checks (Tasks 29/31/32) | ✅ |
| Conversations, feedback, budgets, cache | verbatim conversations/gateway libs | test-conversations 44/44 on :3005 | ✅ |
| ML: training, artifacts, activation, status | verbatim ml/* on PG | ml/status active artifact + metrics (Task 31); research 48/48 | ✅ |
| Reminder engine: ticks, idempotency, shadow, consent-gating | verbatim reminder-engine booted Express-side | tick observation on PG (zero errors); tick route 200; study consent in research suite | ✅ |
| Reports, PDF, translation, readability | verbatim report routes (fonts copied) | full-site report checks on :3005 | ✅ |
| Study/research consent + PII-free export | verbatim study routes | test-research 48/48 on :3005 | ✅ |
| Preferences/timezone/calendar + graceful no-token | verbatim routes | full-site + A3 smoke on :3005 | ✅ |
| Bilingual UI, RTL, accessibility | client copied verbatim + i18n contexts | browser E2E EN↔العربية dir flip (Task 28); notif-l10n 48/48 | ✅ |
| Socket.IO realtime + HMAC bridge | shared service (ADR-03) | signed 200 / unsigned 401; client "Joined user room" | ✅ |
| Safe errors, rate limits, secrets server-side | verbatim http.ts/rate-limit.ts + env policy | test-security on :3005; secrets scan clean | ✅ |
| Health/readiness/metrics | verbatim routes | healthz/readyz 200 on :3005 (DB + ML registry reported) | ✅ |
| Recoverable baseline until cutover | Next :3000 untouched + P1 backup | baseline test-security 23/23 re-proof; verify-data 9/9 | ✅ |
| Android preparation | Capacitor scaffold + ANDROID_READINESS (Task 33) | gated behind G9 per plan §P11 | ⏳ by design |

**Totals: 350/350 checks green on the migrated stack** (REGRESSION_REPORT §1) + PG reconcile (verify-data equivalent).
