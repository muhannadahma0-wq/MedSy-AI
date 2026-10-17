# MedSync-AI — Intelligent Medication Adherence Platform

**Implementation map of MEDSYNC-001 … MEDSYNC-010** on the current stack
(Next.js 16 App Router + Prisma/SQLite + socket.io mini-service), adapted from
the original MongoDB/Express research plan.

```
Medication → Dose Schedule → Dose Event → User Behavior → ML Risk Prediction
           → Adaptive Reminder → User Action → Outcome → Analytics / Model Evaluation
```

## Research questions coverage

| RQ | Question | Where it lives |
|---|---|---|
| RQ1 | Can per-dose behaviour be predicted from history? | `lib/server/ml/*` — temporal split, ROC-AUC/PR-AUC/Brier/calibration; promotion only on evidence |
| RQ2 | Do risk-adaptive reminders reduce unconfirmed doses? | SmartReminder ledger (shadow → live A/B ready), EXTRA escalation for high-risk doses |
| RQ3 | Is the platform reliable? | Idempotent DB-backed engine, boot recovery, bug-register discipline |
| RQ4 | Bilingual UI (EN/AR)? | Intelligence page fully bilingual incl. per-feature explanations |

## Data foundation (MEDSYNC-002/003)

| Model | Purpose |
|---|---|
| `DoseEvent` | One row per scheduled dose: `scheduledAt/actualAt/status(pending·taken·delayed·missed·skipped)/delayMinutes/riskScore/modelVersion/source`. Unique `(medicationId, scheduledAt)` |
| `SmartReminder` | Reminder ledger, unique `(doseEventId, type, scheduledAt)` → idempotent replays; `mode` shadow·live; `status` logged·sent·skipped |
| `RiskPrediction` | Every score persisted with its exact feature vector + bilingual explanation |
| `ModelArtifact` | Versioned models with full metric reports; `isActive` marks the serving model |

Migration (`migrateAdherenceHistory`) rebuilds the legacy `adherenceHistory`
JSON into DoseEvents — `scheduledAt` = the record's day at its slot time
(the legacy `date` field stores the click moment). "Taken" clicks >30 min late
are honestly classified `delayed`. Scheduler materializes a 2-day-back /
7-day-ahead window; stale pending doses auto-transition to `missed`
("not confirmed" — never "non-adherent").

`/api/medicine/status` dual-writes: legacy JSON fields stay byte-compatible
for the original UI while the outcome mirrors into today's DoseEvent.

## Adherence engine (MEDSYNC-005)

`lib/server/adherence-engine.ts` — confirmed/on-time/not-confirmed rates,
streak, average delay, weekday/slot/daily patterns — all from DoseEvents.

## ML layer (MEDSYNC-007)

- **Features (12, leakage-free):** hour, isEvening, isWeekend, dosesPerDay,
  medicationCount, adherenceRate7d, missedLast7d, streak, avgDelay7d,
  slotMissStreak, medAgeDays, dosesTodaySoFar — computed strictly from events
  before the dose.
- **Label:** `1 = delayed|missed` ("not confirmed on time"), `0 = taken`.
- **Models:** deterministic rule baseline + logistic regression
  (standardized, class-balanced, L2, batch GD) — both serialized in
  ModelArtifact.
- **Evaluation:** temporal 70/30 split; ROC-AUC (tie-corrected), PR-AUC
  (average precision), Brier, log-loss, 10-bin calibration, confusion —
  accuracy reported but never alone.
- **Promotion:** LR activates only if its temporal-test ROC-AUC ≥ baseline's;
  otherwise the baseline stays with the recorded reason.

Current state (demo profile, 12 medications): 67 resolved events, 27
positives; LR `lr-v…` active (ROC-AUC 0.50 vs baseline 0.39; Brier 0.09).

## Unified reminder engine (MEDSYNC-004/008/009/010)

`lib/server/reminder-engine.ts` + `src/instrumentation.ts`:

1. Per-user tick (60 s loop + on-demand `/api/reminder-engine/tick` +
   `/api/notification/regular-notify` delegation): materialize →
   auto-transition → risk-score (48 h horizon, 6 h rescore cadence) →
   plan reminders (12 h horizon).
2. Reminder set per dose: `before`/`onTime`/`after` from the medication's own
   `remindBefore`/`remindAfter` (original personalized messages reused
   verbatim) + **`extra`** escalation 15 min after the slot **only for
   high-risk doses**, with an honest reason built from the stored features.
3. **Shadow mode** (`SMART_REMINDERS=shadow`, default): every decision is
   logged (`status=logged`) and nothing is delivered — the evaluation-safe
   baseline for the study. **Live mode** delivers via the socket.io bridge
   (3003/3004) + DailyNotification, exactly like the original app.
4. Restart safety: all state in SQLite; boot tick re-plans idempotently;
   reminders >15 min overdue are marked `skipped`, not spammed.

## Explainability (MEDSYNC-009)

Every prediction persists per-feature signed contributions
(`weight × standardized value` for LR; rule deltas for the baseline) with
bilingual labels and formatted values, plus a standing disclaimer
(behavioural estimate, not medical judgement). The Intelligence UI renders
them as contribution bars (rose = increases risk, emerald = protective).

## API surface (new)

| Route | Purpose |
|---|---|
| `GET/POST /api/dose-events` | Query today/upcoming/history; run prepare/migrate/materialize |
| `POST /api/ml/train` | Train + evaluate + register + evidence-based promotion |
| `GET /api/ml/status` | Active model, artifacts, reminder counts, engine mode |
| `POST /api/reminder-engine/tick` | Manual engine tick (user or all) |
| `GET /api/intelligence/overview` | Single call powering the Intelligence page |

## UI

`/#/intelligence` — "Adherence Intelligence" page (Rhythm v4 identity):
mode badge, adherence stats, 48 h risk forecast with expandable honest
explanations, model status with metrics + calibration, engine actions
(tick / retrain), reminder ledger, dose-event history, weekday/slot patterns.
Sidebar entry in Dashboard + agents navigation. Fully bilingual EN/AR, RTL,
mobile-verified (390 px, zero overflow).

## Honesty rules enforced in code

- "Not confirmed" terminology — never claims the user skipped.
- Predictions always carry the exact feature vector they were made from.
- Model promotion requires temporal-test evidence; ties keep the simpler model.
- Shadow mode is the default; nothing reaches the user without `live`.
- Demo/test data pollution is tracked in the bug register and cleaned, never
  silently mixed into evaluation numbers.

---

# Stage 3 — Study Infrastructure & Model Selection (plan §11–12, §16, §24, §27–32, §42–43)

## User actions on doses

| Action | Semantics | Implementation |
|---|---|---|
| **Snooze** (§11) | New *notification* time — never a schedule change; survives restart; auto-cancels if the dose resolves first | `POST /api/dose-events/snooze` → `SmartReminder{type:"snooze", mode:"live"}`; delivered by the tick loop even in shadow (user-requested); Snooze 10m button on the notification toast |
| **Skip** (§12) | Deliberate skip with a reason — a behavioural signal, not a medical decision | `POST /api/dose-events/skip` → DoseEvent `status="skipped"` + `skipReason` (forgot / not_needed / doctor / side_effects / other) + legacy dual-write; reason picker on the Dashboard |

## Four-candidate model selection (§16)

Baseline, Logistic Regression, **Gradient Boosting**, **Random Forest** —
pure-TS trees, seeded (deterministic), trained and evaluated on the same
temporal split; evidence-based promotion (ROC-AUC → Brier → simplicity).
The Intelligence page shows the candidates comparison table with the active
model highlighted. Tree ensembles explain via **global feature importance**
(labeled as such — no fabricated per-dose attributions).

## Controlled study (§27–32)

- `StudyAssignment` (control | smart), balanced auto-assignment, operator
  re-assignment endpoint (pilot setup only).
- Engine gating: EXTRA high-risk reminders are planned **only for the smart
  arm**; the control arm's withholding is counted (`suppressedExtra`) and
  audited (`integrity.controlExtraSent === 0`).
- `GET /api/study/status` · `POST /api/study/assign` ·
  `GET /api/study/export` (pseudonymized CSV/JSON — sha-256 participant ids,
  M01… medications, no names/emails/pill names) ·
  `GET /api/study/outcomes` (primary high-risk unconfirmed rate per arm with
  Wilson 95% CIs, Newcombe difference CI, secondary outcomes, integrity
  check, bilingual §18 disclaimers).
- Intelligence page → "Controlled Study" panel: arm badge + description,
  participants, primary-outcome table, difference line, integrity note,
  dataset export button (blob download).

## Observability & performance (§42–43)

- `GET /api/healthz` (liveness: version/uptime/engine mode),
  `GET /api/readyz` (db SELECT 1, ML registry, DoseEvent store; 503 on fail),
  `GET /api/metrics` (per-route p50/p95/p99 + errors — route names and
  milliseconds only, never sensitive data).
- Research-core routes instrumented via `withMetrics()`; measured numbers are
  available from the in-memory latency recorder (`/api/ai-monitoring`).

## New/changed files (stage 3)

- New: `src/lib/server/study.ts`, `src/lib/server/study-stats.ts`,
  `src/lib/server/metrics.ts`, `src/app/api/dose-events/{skip,snooze}/route.ts`,
  `src/app/api/study/{status,assign,export,outcomes}/route.ts`,
  `src/app/api/{healthz,readyz,metrics}/route.ts`.
- Extended: `prisma/schema.prisma` (DoseEvent.skipReason, StudyAssignment,
  SmartReminder type `snooze`), `reminder-engine.ts` (snooze delivery +
  resolved-dose guard + arm gating), `ml/{models,train,predict}.ts`
  (RF/GB + candidates + explanationKind), `intelligence/overview` route +
  `intelligence.jsx` (candidates table, study panel, global-importance
  explanations), `Dashboard.jsx` + `NotificationToast.jsx` (Skip/Snooze UI).

## Stage-3 verification highlights (browser + API, this environment)

- Snooze scheduled +1 min → auto-delivered by the background loop
  (status `sent`, dev.log tick line); a snooze on a resolved dose was
  auto-cancelled (`skipped`).
- Skip flow E2E: reason picker → card chip "Skipped" → DB row
  (`skipReason:"not_needed"`, `source:"user"`) — and Mark Taken still works
  afterwards (POST 200, dual-write confirmed).
- Study export CSV: 168+ rows, pseudonyms only (grep-clean of emails and
  pill names); outcomes endpoint returns Wilson/Newcombe values that match
  hand-computed references; `controlExtraSent = 0`.
- Four candidates trained deterministically twice — identical metrics;
  LR promoted (ROC-AUC 0.737 vs baseline 0.118) with the small-dataset
  caveat attached.
- RTL Arabic verified on the Intelligence page (study panel + candidates
  table), 390 px mobile zero overflow, agents chat answered in Arabic,
  page errors: none; `bun run lint`: 0/0.
