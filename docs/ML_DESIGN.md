# ML Design — Dose-Risk Prediction Layer

> Plan §14–22 (data pipeline, features, models, validation, metrics,
> calibration, versioning, explainability). Implementation:
> `src/lib/server/ml/{features,models,metrics,train,predict}.ts`.

## 1. Task & label

Per-dose binary classification: will this scheduled dose be **unconfirmed on
time**? Label `1` = `delayed | missed`; `0` = `taken` on time. `pending`
doses are unlabeled; `skipped` doses are excluded from the label (they are a
separate user action recorded with a reason).

## 2. Data pipeline

```
Medication → DoseEvent (source of truth) → resolved historical events
        → feature engineering → training dataset
```

The legacy `adherenceHistory` JSON was migrated into DoseEvents (counts
reconciled) and is **not** an ML source anymore.

## 3. Features (V1 — all computed strictly BEFORE the dose)

| # | Feature | Meaning |
|---|---|---|
| 1 | `hour` | Scheduled hour of day |
| 2 | `isEvening` | Evening dose indicator |
| 3 | `isWeekend` | Weekend indicator |
| 4 | `dosesPerDay` | Regimen load |
| 5 | `medicationCount` | Number of active medications |
| 6 | `adherenceRate7d` | Confirmed/resolved, prior 7 days |
| 7 | `missedLast7d` | Missed doses, prior 7 days |
| 8 | `streak` | Current confirmed-day streak |
| 9 | `avgDelay7d` | Mean delay minutes, prior 7 days |
| 10 | `slotMissStreak` | Consecutive misses at this time slot |
| 11 | `medAgeDays` | Days on this medication |
| 12 | `dosesTodaySoFar` | Doses already due today |

No feature reads data at or after the scheduled moment — no future leakage.

## 4. Models (four candidates, plan §16)

| Candidate | Type | Notes |
|---|---|---|
| Rule baseline | deterministic | The honesty floor — any trained model must beat-or-tie it |
| Logistic regression | trained | Standardized features, class-balanced batch GD, L2 |
| Gradient boosting | trained | 60 × depth-2 logistic-loss regression trees, lr 0.1, leaf clamp [−2, 2] |
| Random forest | trained | 60 class-balanced bootstrapped trees, depth ≤ 4, √d feature subsampling, Laplace leaves |

Trees are pure TypeScript (no ML libraries), deterministic via a seeded
`mulberry32(42)` RNG — identical inputs produce identical models (verified by
double-training).

## 5. Validation & promotion

- **Temporal** 70/30 split (chronological; never random) — past trains,
  future tests.
- All candidates evaluated on the **same** test split.
- Metrics: ROC-AUC (tie-corrected), PR-AUC, Brier, log-loss, accuracy
  (secondary only), confusion, 10-bin calibration.
- Promotion is evidence-based: best test ROC-AUC among candidates that
  beat-or-tie the baseline; tie-break lower Brier, then simpler model.
  If data is below thresholds (30 resolved / 5 positives) the baseline stays
  with a recorded reason.
- Every run registers a versioned `ModelArtifact`
  (`weights` JSON + `metrics` JSON + train/test rows + isActive) — versioning
  per plan §22 (`lr-v<stamp>`, `rf-v<stamp>`, `gb-v<stamp>`, `baseline-v1`).

## 6. Current measured results (demo data — honest)

Temporal split 47 train / 21 test, 68 resolved events, 28 positives
(prevalence 0.41; test split drifted positive — 19/21):

| Candidate | ROC-AUC | PR-AUC | Brier | Promoted |
|---|---|---|---|---|
| Rule baseline | 0.118 | 0.833 | 0.150 | |
| Logistic regression | **0.737** | 0.974 | 0.836 | ✅ |
| Gradient boosting | 0.408 | 0.904 | 0.551 | |
| Random forest | 0.566 | 0.935 | **0.241** | |

Reading this honestly: LR discriminates best on this split but is poorly
calibrated (Brier 0.836) because the tiny test split drifted positive; RF is
the best-calibrated trained model. The promotion criterion (ROC-AUC) chose
LR. With real study data the ranking may change — that is why promotion is
re-evaluated on every training run, and why the small-dataset caveat is
attached to every report ("pipeline validation, not clinical evidence").

## 7. Prediction & explainability (plan §25)

- Pending doses are scored by the active artifact (60 s cache), each score
  persisted as `RiskPrediction` with its exact feature vector.
- **Logistic / baseline**: signed per-feature contributions
  (weight × standardized value, or rule deltas) — the "Why this risk?"
  panel. Never fabricated.
- **Tree ensembles**: global feature importance (Gini / split-MSE reduction,
  normalized) rendered as "Model feature importance" — the UI labels the
  difference explicitly (`explanationKind: per-dose | global-importance`).
- Every prediction carries the bilingual behavioural-estimate disclaimer.

## 8. Real-data pipeline (plan §24)

Training consumes DoseEvents directly (the study export CSV is the
pseudonymized research artifact, not the training input — same underlying
events). No names, emails, or medicine names enter features.

## 9. V2 features (planned, blocked on data volume)

Reminder response time, ignored reminders, delay variance, regimen
complexity, medication changes, time since last miss, recent taken streak.
Each must be implemented, evaluated, and documented before use (plan §17).
