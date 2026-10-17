# Limitations & Honest Deviations — MedSync AI (this rebuild)

> The graduation plan targets a React+Vite/Express/MongoDB deployment.
> This rebuild runs on the sandbox stack (Next.js 16 + SQLite/Prisma + a
> socket.io mini-service). Every functional deviation is listed here rather
> than hidden.

## Stack deviations (functional parity kept)

1. **MongoDB → SQLite (Prisma)**. The plan's MongoDB-specific items (Docker
   compose with Mongo, NoSQL-injection checks) do not apply. Prisma
   parameterizes all queries; the DoseEvent/SmartReminder/RiskPrediction/
   ModelArtifact/StudyAssignment models carry the same fields the plan
   specifies.
2. **Docker / docker-compose**: not possible in this sandbox. The deployment
   story is the dev server + gateway; the plan's §45 verification
   (`docker compose up --build`, restart durability) is therefore **not
   demonstrated** here. Restart-safety *is* demonstrated at the application
   level (boot recovery tick, idempotent ledger).
3. **CI/CD (§44)**: no pipeline runner in the sandbox. The equivalent gates
   used: `bun run lint` (0 errors/warnings) + scripted API smoke tests +
   agent-browser E2E passes on every stage.
4. **Offline synchronization (§38)**: the original repo's IndexedDB sync
   engine was **not ported** into this rebuild. Offline is documented as
   future work; no offline claims are made for this version.
5. **Unit/integration test suites (§41)**: this environment does not include
   a test runner setup; verification is performed through scripted API
   checks and browser E2E. Formal test code remains
   to be added when the project moves to its final repository.
6. **FHIR (§46)**: intentionally deferred by the plan itself until after
   P0/P1 — not started.
7. **Provider keys / region**: `.env` now carries the owner-re-supplied
   `GROQ_API_KEY` + `GOOGLE_API_KEY` (2026-10-09; `healthz`: both tiers on).
   The preview sandbox egress (Hong Kong) is still region-blocked by both
   vendors (Groq 403 / Gemini "location not supported" — key-level auth
   passes), so live answers keep flowing through the z-ai fallback; the
   Groq/Gemini tiers reactivate automatically from a supported network.

## Data honesty

- All ML/outcome numbers come from **one demo user** with synthetic-ish
  behavioural history (~180 dose events). They validate the pipeline; they
   are **not** clinical evidence (disclaimers attached at every surface).
- The demo user's StudyAssignment was reassigned during verification
  (`reason: "operator"`) and restored to `control`.
- The current temporal test split is small and positive-skewed (19/21),
  which inflates Brier scores for probability models — documented in
  ML_DESIGN.md §6.

## Known minor issues

- `agent-browser` clicks on the sidebar language pill occasionally miss the
  element (overlay interference); the control itself works (verified via
  DOM click + PUT 200 + RTL flip).
- Next.js dev-overlay flags HMR WebSocket timeouts as "issues" — dev-server
  artefact, not an application error.
- The in-memory latency recorder resets on restart and does not cover
  non-instrumented routes (by design).
- Skip is exposed only for doses with a pending DoseEvent for today; legacy
  JSON-only slots (no materialized event) show a graceful error toast.

## Not yet executed (roadmap)

- Pilot study with real participants (ethics prerequisites — STUDY_PROTOCOL §8).
- Security regression suite + rate limiting hardening (§39).
- Offline sync port (§38), FHIR (§46), thesis chapters (§49).


## Phase 3/4/12 session additions (2026-09-27)

- **Timezone semantics (Phase 3)**: slot times are interpreted in the user's
  IANA timezone (`User.timeZone`, auto-captured at login/signup, overridable
  in Settings). One deliberate semantic change: slots whose grace window
  fully elapsed before ever being materialized are **not** back-filled as
  instant "missed" rows (no retroactive fabrication) — a dose that was never
  tracked as upcoming is not recorded as a miss. This also makes timezone
  changes duplicate-free (only future pending scheduler rows are rebuilt).
- **Timezone-change boundary seam**: resolved doses from before a timezone
  change keep their original absolute times (history is never rewritten), so
  the first day after a change can show historical buckets at the old local
  clock. One-time cosmetic seam, documented rather than silently rewritten.
- **Reminder response time** (Analytics 2.0) is measurable only where
  reminders were actually SENT (mode "live" or snoozes) — in shadow mode the
  sample count is honestly small (shown as `samples` in the UI).
- **localStorage token mirror** remains for the socket.io handshake (see
  SECURITY_ASSESSMENT §1/§5).

## Phase 8/11/13/15 session additions (2026-09-28)

- **Offline sync (Phase 11) — now real, with honest edges**: the queue
  replays only while an app tab is open (no service-worker background sync);
  first load while offline shows an empty medication list (write queue only,
  no read cache); the queue is per-browser, not per-user (a shared machine
  replays user A's writes under user B's session into the dead-letter ledger
  — auth-keyed, no corruption, but the intent is lost). Skip/Snooze are
  deliberately NOT queued offline (they need a fresh pending DoseEvent id;
  replaying a stale id would misattribute the action). Full policy:
  docs/OFFLINE_SYNC.md.
- **AIRouter (Phase 8)**: intent classification is deterministic
  keyword-rule based, not learned — a phrasing outside the keyword lists
  falls through to the general Medical agent (safe default, possibly the
  "wrong" specialist for exotic phrasings). The matched keywords are
  returned with every answer (`router.matched`) so misroutes are visible,
  not hidden.
- **Text-size control (Phase 13)**: scales rem-based Tailwind typography via
  root font-size; a few fixed-px decorative elements do not scale. WCAG
  audit and a high-contrast mode remain future work.
- **Latency metrics (Phase 15)**: small sequential samples (n = 2–7) on a
  dev server — order-of-magnitude readings, not tail-latency claims).
