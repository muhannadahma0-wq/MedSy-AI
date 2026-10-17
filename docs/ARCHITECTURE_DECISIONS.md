# ARCHITECTURE_DECISIONS.md — Migration ADRs

**Owner:** Agent 1 · **Status:** approved at Gate G2 · **Convention:** each ADR records context → decision → consequences.

---

## ADR-01 — Migration lives under `migration/`, root stays the Next.js baseline

**Context:** The plan's §4 proposes `client/` + `server/` at repository root. P0 inspection found the root occupied by the running, user-visible Next.js baseline (plan principle 6: keep a recoverable original until cutover approval; the sandbox mandates the Next.js service on port 3000).

**Decision:** Target layout is `migration/client` (Vite React) and `migration/server` (Express TS), with `docs/` carrying all migration documentation. Shared services (socket-service 3003/3004) stay where they are and are reused as-is.

**Consequences:** Zero risk to the baseline; both targets remain independently buildable/runnable; cutover on the owner's infrastructure is a copy-out of `migration/` + `.env` + socket-service. Deviates from the plan's letter, honors its intent (explicitly permitted: "Adjust it only after Phase 0 source inspection").

## ADR-02 — Express hosts the route handlers through a web-standard compatibility shim (no rewrite of the 62 handlers)

**Context:** P0 found **zero** `next/server` / `next/headers` imports: every route handler is `async (req: Request) => Response` using web-standard APIs (`req.json()`, `new Response(...)`, `Headers`), including the three dynamic routes whose only Next coupling is the `{ params: Promise<...> }` second argument.

**Decision:** `migration/server` copies `src/lib/**` and `src/app/api/**/route.ts` verbatim and mounts them in Express via a small adapter that:
1. converts the incoming Express request into a `globalThis.Request` (raw body preserved — JSON, multipart and binary pass through untouched; size limits applied);
2. synthesizes `{ params: Promise.resolve({...}) }` for dynamic segments from Express path params;
3. streams the handler's `Response` (status/headers/body) back through Express;
4. auto-discovers exported `GET/POST/PUT/DELETE/PATCH` per route module from a generated manifest of all 62 files.

**Consequences:** API contracts are preserved *verbatim* (same bodies, same status codes, same error contract from `lib/server/http.ts`); the migration surface shrinks to the adapter + bootstrap; future Next-side handler changes are visible as copy drift (documented as a maintenance note until cutover). This is the single most important risk-reduction decision of the migration.

## ADR-03 — Socket.IO service and HMAC bridge are shared, not duplicated

**Context:** The socket mini-service (3003) and its loopback-only signed `/emit` bridge (3004) are already an independent process with JWT handshake auth, room isolation, and HMAC-SHA256 over the raw body. `notifications.ts` / `reminder-engine.ts` call `http://127.0.0.1:3004/emit` with the shared `JWT_SECRET`.

**Decision:** The Express server reuses the same socket-service and the same bridge contract unchanged (same env secret).

**Consequences:** No behavioral drift in realtime delivery; the bridge signature test (test-security) remains applicable to the migrated stack. On cutover, the socket-service ships alongside the Express server exactly as it ships today.

## ADR-04 — Client restores `BrowserRouter` (original product behavior); Express serves the SPA fallback

**Context:** `ClientApp.jsx` documents that the original app used `BrowserRouter` and the sandbox port swapped it to `HashRouter` only because the whole app had to live on the single Next.js `/` route. The migration restores the separated architecture.

**Decision:** The Vite client mounts `BrowserRouter` (one-line restoration, explicitly noted in the file); the Express server serves the built SPA and falls back to `index.html` for non-API GET routes.

**Consequences:** URLs return to the original form (`/dashboard` instead of `/#/dashboard`); history navigation works; the change is recorded here per the plan's "preserve behavior unless a justified change is approved and documented".

## ADR-05 — PostgreSQL via `embedded-postgres` (non-root) on port 5433; SQLite backfill preserves IDs

**Context:** PostgreSQL is not installed in the sandbox and there is no root. The plan treats P5 as a data-integrity project (not a connection-string change).

**Decision:** Attempt `embedded-postgres` (npm binaries, user-mode cluster in `migration/server/pgdata`, port 5433). The PG schema is generated from the same 14 models (`provider = "postgresql"`); the backfill reads the SQLite backup copy and writes to PG with **IDs preserved** (cuid strings are portable); a reconciliation script re-counts all 14 models and compares. If the embedded cluster cannot run in this environment, the delivered artifacts (schema, backfill, reconcile) are marked ready-to-run and Gate G5 is reported BLOCKED with the exact missing dependency (a PostgreSQL server).

**Consequences:** Best-effort *real* PG verification inside the sandbox; either way the owner receives a repeatable, tested-where-possible migration path. SQLite types map 1:1 (String/DateTime/Int/Boolean/Float/Json all exist in PG; no enums exist in the schema).

## ADR-06 — Test scripts gain an additive `BASE_URL` override

**Context:** The verification scripts hardcode `http://localhost:3000`. The migrated Express API listens on 3005. The plan forbids weakening tests but requires the same suites to verify the migrated stack.

**Decision:** Each HTTP-driving script changes exactly one line: `const BASE = process.env.BASE_URL || "http://localhost:3000"`. Default behavior is byte-identical; no assertion is touched.

**Consequences:** The identical 350-check battery can run against the Express server (`BASE_URL=http://localhost:3005 bun run scripts/test-*.ts`), satisfying P9-02..P9-07 without duplicating any test code.

## ADR-07 — No cutover inside this environment

**Context:** The sandbox's user-visible surface is the Next.js service; the plan's own governing outcome #5 requires the original to stay recoverable until cutover is explicitly approved.

**Decision:** Cutover is out of scope here. The deliverable is the independently runnable `migration/` stack + full evidence + `DEPLOYMENT_RUNBOOK.md` for the owner's infrastructure.

**Consequences:** The preview keeps showing the Next.js original (by design); the migrated stack is proven by curl/agent-browser evidence against localhost:3005. Android (P11) remains gated behind G9 and is delivered as Capacitor scaffolding + readiness documentation.
