# TEST_STRATEGY.md — Migration Verification (plan §10)

**Owner:** Agent 6 · **Validated:** 2026-10-10 · **Principle:** the SAME suites verify baseline and migrated stack (ADR-06) — adaptation is environmental only, never assertion-level.

## Layer → suite mapping

| Plan layer | Implementation | Environment |
|---|---|---|
| 1. Static checks | `bun run lint` (baseline repo); `bun build --no-bundle` parse checks for adapted scripts; vite build (client) | both |
| 2. Frontend checks | `migration/client` vite build (2,351 modules) + agent-browser E2E (landing/login/dashboard, EN↔AR RTL, socket connect, zero console errors) | migrated |
| 3. Unit tests | test-conversations-unit (32), test-notif-l10n (48) — source-module logic; code byte-identical in migration (diff-proven) | baseline + equivalence proof |
| 4. API integration | test-med-crud (40), test-full-site (56), test-e2e-golden-path (34) | :3000 and :3005 |
| 5. Data migration | migration/database verify:all (generate ×2 → db push → backfill → reconcile: 5 check families incl. full row-level equality) | PG :5433 |
| 6. Security | test-security (23): BOLA, session invalidation, rate limits, safe errors, upload validation, signed-bridge accept/reject + P6 curl checks (CORS, cookie-only auth, secrets scan, socket isolation) | :3000 and :3005 |
| 7. AI tests | test-agent-suite (25): specialist selection, user-scoped tools, provider fallback, vision validation, budgets, output safety | :3000 and :3005 |
| 8. ML/reminder | test-research (48), golden-path prediction persistence, engine tick observation on PG, consent gating via study suites | :3000 and :3005 |
| 9. End-to-end | test-conversations (44, AI-driven threads), golden path (34), full-site (56) | :3000 and :3005 |
| 10. Operational | healthz/readyz contracts, SIGTERM graceful shutdown (A3), service restart recovery (engine boot tick), backup/restore (P1 backup + PG disposable cluster + verify:all rerun) | both |

## Environments

- **Baseline**: Next.js :3000 + SQLite (db/custom.db) — the recoverable original.
- **Migrated**: Express :3005 (ADR-02 shim) + PostgreSQL 17.10 :5433 + Vite client :5173/dist + shared socket :3003/:3004.

## Evidence format (enforced)

Every result records: exact command, environment vars, actual output counts, known deviations (archived REGRESSION_REPORT §3 — worklog.md), and the worklog entry. No suite is claimed without a captured run.

## Migrated-run invocation

`BASE_URL=http://localhost:3005 TEST_PRISMA_CLIENT=<migration/server PG client> TEST_DB_MODULE=<migration/server db.ts> DATABASE_URL=postgresql://… bun run scripts/<suite>.ts` (+ `AI_DAILY_AGENT_REQUESTS=2 AI_GLOBAL_AGENT_DAILY=3` for conversations). Defaults unchanged → baseline behavior byte-identical (re-proven after every extension).
