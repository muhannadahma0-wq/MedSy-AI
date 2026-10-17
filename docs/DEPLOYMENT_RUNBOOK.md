# DEPLOYMENT_RUNBOOK.md — Migrated Stack (Phase P10, Gate G10)

**Owner:** Agent 1 (Lead) · **Scope:** deployment, operations, backup/recovery, rollback for the migrated stack (React/Vite client + Express API + PostgreSQL + Socket.IO). **Cutover is NOT executed in this environment** (ADR-07) — this runbook is the owner's validated path. Every command below was executed successfully in this sandbox during Tasks 28–32 unless marked *(owner environment)*.

## 1. Components & ports

| Component | Location | Port (sandbox) | Production equivalent |
|---|---|---|---|
| React client (build) | `migration/client` (dist/) | 5173 dev / served by Express | static CDN or same origin as API |
| Express API | `migration/server` | 3005 | HTTPS origin (e.g. api.domain) |
| PostgreSQL | cluster | 5433 (embedded, disposable) | managed PostgreSQL ≥ 14 |
| Socket.IO service | `mini-services/socket-service` | 3003 + signed bridge 3004 | same host/container as API or adjacent |

## 2. First deployment (owner environment)

```bash
# 1) Database — provision PostgreSQL, then:
cd migration/database
#    set .env: DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/medsync
bun install
bun run verify:all          # generate → db push → backfill (from the SQLite backup) → reconcile
#    (or start from the LIVE sqlite export instead of the backup — same script, retarget prisma-sqlite url)

# 2) API server
cd ../server
#    set .env: DATABASE_URL=<same PG url>, JWT_SECRET=<strong secret>, GROQ_API_KEY/GOOGLE_API_KEY (optional tiers), SMART_REMINDERS=shadow|live
bun install && bunx prisma generate
( setsid bun run start > server.log 2>&1 & )     # production: bun src/server.ts under systemd/PM2/container

# 3) Client
cd ../client
#    set .env.production: VITE_API_URL=https://api.<domain>, VITE_SOCKET_URL=wss://api.<domain>, VITE_GOOGLE_CLIENT_ID=<id>
bun install && bun run build                     # → dist/ (serve via nginx/CDN; Express also serves it as SPA fallback)

# 4) Socket service
cd ../../mini-services/socket-service
#    .env: JWT_SECRET=<same secret>, SOCKET_CORS_ORIGINS=https://app.<domain>
( setsid bun run dev > socket.log 2>&1 & )
```

**Single-scheduler rule (critical):** exactly ONE reminder-engine instance runs — the Express server. Never point two servers (e.g. the old Next.js app AND Express) at the same database with engines booted. If a distributed deployment needs multiple API replicas, disable the engine on all but one (or add a leader lock) — see `migration/server/OPERATIONS.md`.

## 3. Environment contract

- **Server (`migration/server/.env`)**: `DATABASE_URL` (postgresql://…), `JWT_SECRET` (strong; shared with the socket service), `GROQ_API_KEY`/`GOOGLE_API_KEY` (optional provider tiers — chain degrades to z-ai/GLM without them), `GROQ_CHAT_MODEL`/`GEMINI_MODEL`/`REPORT_CHAT_MODEL` (model overrides), `SMART_REMINDERS` (shadow|live), `AI_DAILY_AGENT_REQUESTS`/`AI_GLOBAL_AGENT_DAILY` (budgets), `PROVIDER_TIMEOUT_MS`.
- **Client (public only)**: `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_GOOGLE_CLIENT_ID`. NEVER any secret.
- **Socket service**: `JWT_SECRET`, `SOCKET_CORS_ORIGINS` (production: real origins, not `*`).

## 4. Health & monitoring

- `GET /api/healthz` — liveness + honest provider flags. `GET /api/readyz` — DB + ML registry readiness. `GET /api/metrics` — app metrics (no PII). `GET /api/ai-monitoring` — per-agent traffic, provider chains, breaker states (auth).
- Logs: `migration/server/server.log` (engine ticks, provider failovers, breaker transitions) — ship to the platform's log pipeline.

## 5. Backup & restore

- **Source baseline (until cutover):** `db/backups/pre-migration-20261010-073438.db` + the untouched Next.js app on :3000 — full rollback path.
- **PostgreSQL:** standard `pg_dump`/`pg_restore` (or managed snapshots). Restore drill: point `DATABASE_URL` at the restored DB, restart Express, run `readyz` + a suite spot-check (the battery is env-driven; evidence archived in worklog.md).
- **Re-run the whole migration idempotently:** `cd migration/database && bun run verify:all`.

## 6. Rollback (pre-cutover and post-cutover)

| Scenario | Action |
|---|---|
| Migrated stack defective before cutover | Baseline :3000 never stopped — just keep using it; fix forward in `migration/`. |
| Bad data write on PG (post-cutover) | restore latest pg_dump; the reminder engine resumes idempotently from DB state (boot recovery tick). |
| Full revert | re-point the domain at the Next.js deployment + SQLite; `migration/` is purely additive to the repo. |

## 7. Cutover checklist (owner approval gate)

1. ☐ Production PG restored/verified (`verify:all` green on production DB)
2. ☐ Express + socket running under process managers with restart policies
3. ☐ Client built with production `VITE_*`; HTTPS everywhere; CORS origins locked
4. ☐ `SMART_REMINDERS` decision (shadow → live) recorded; consent-gating re-tested (test-research)
5. ☐ One scheduler instance confirmed (logs show a single engine tick stream)
6. ☐ Smoke: healthz/readyz/login/medicine/agents/monitoring green on production URLs
7. ☐ Backup schedule active on PG; restore drill signed off
8. ☐ Baseline Next.js kept read-only for a grace period, then decommissioned by owner decision

## 8. Verified-in-sandbox quickstart (what this sandbox actually runs today)

```bash
# services already running: Next :3000 · socket :3003/:3004 · Express :3005 (PG) · Vite dev :5173 · PG :5433
curl -s localhost:3005/api/healthz        # status ok, provider flags
curl -s localhost:3005/api/readyz         # db + mlRegistry
BASE_URL=http://localhost:3005 TEST_PRISMA_CLIENT=/home/z/my-project/migration/server/node_modules/@prisma/client/index.js TEST_DB_MODULE=/home/z/my-project/migration/server/src/lib/db.ts DATABASE_URL=postgresql://medsync:medsync@127.0.0.1:5433/medsync bun run scripts/test-security.ts   # 23/23
```
