# Study Protocol — Controlled Evaluation of Risk-Targeted Reminders

> Plan §27–32. This document specifies the intervention study that the
> MedSync AI platform is built to host. The **infrastructure is live and
> verified**; running the study with real participants requires the ethics
> prerequisites in §8 below and is **not** part of the demo deployment.

## 1. Research questions

- **RQ1** (model): Can historical medication-taking behavior predict whether
  an upcoming scheduled dose will be unconfirmed?
- **RQ2** (intervention): Does targeted additional reminding of predicted
  high-risk doses improve dose confirmation compared with standard reminders?

We do not presuppose the answer to RQ2 — the study determines it.

## 2. Design

Prospective two-arm controlled study at the dose level.

| Arm | Reminders received | ML scoring |
|---|---|---|
| **Control** | Standard plan only (before / on-time / after) | Yes — logged, never acted on |
| **Smart (intervention)** | Standard plan **+ EXTRA reminder** for doses the model predicts as high-risk | Yes |

Assignment is persisted (`StudyAssignment`), balanced (alternating on
enrollment), and not selectable by the participant. The researcher may
re-assign during pilot setup only (`POST /api/study/assign` — operator
endpoint).

## 3. Population & prerequisites

- Adults managing their own chronic medication schedules.
- Phase A (shadow validation) must complete first: the promoted model must
  show acceptable discrimination **and calibration** on logged real-data
  predictions before any intervention is enabled.
- Before any real health data is used: institutional approval, supervisor
  approval, the required ethics process, and informed consent (plan §29).

## 4. Intervention definition

- Risk model scores every pending dose in the 48 h horizon (12 leakage-free
  behavioural features; temporal-split validation; evidence-based promotion).
- A dose with predicted risk level **high** (per the promoted model's
  threshold) triggers one additional reminder 15 minutes after the scheduled
  slot **for the Smart arm only**, with an honest reason string derived from
  the stored feature values (never fabricated).
- The engine withholds the EXTRA reminder for control-arm users — the
  withholding itself is the experimental contrast (verified:
  `integrity.controlExtraSent === 0`).

## 5. Outcomes

**Primary**: confirmation of high-risk doses → difference in unconfirmed rate
between arms, reported with a 95% confidence interval (Newcombe hybrid-score
method; Wilson intervals per arm). We do not rely on p-values alone.

**Secondary**: overall confirmation rate, on-time rate, average delay,
reminder response time (sent → confirmation), extra-reminder exposure,
ML availability, skipped rate (with reasons).

## 6. Dataset & pseudonymization

`GET /api/study/export` produces the research dataset (CSV or JSON) —
19 columns (updated 2026-10-01 Master Review: the two consent-provenance
columns `consent_version` + `consent_granted_at` ship with every row):

```
participant, arm, medication, dose_scheduled_at, dose_slot, dose_status,
outcome_confirmed, delay_minutes, skip_reason, risk_score, risk_level,
model_version, reminder_type, reminder_scheduled_at, reminder_status,
reminder_sent_at, exported_at, consent_version, consent_granted_at
```

- Participant = `sha256(userId + STUDY_SALT)[0:16]`; medications = `M01…`
  by sorted id. **No names, emails, medicine names, or notes** (plan §24) —
  verified by grep against the live export.
- Identity data and research data are separated: the export contains
  pseudonyms only.

## 7. Analysis plan

- Per-arm Wilson 95% CIs for the primary rate.
- Difference (Smart − Control) with a Newcombe 95% CI.
- `estimable: false` with an explicit reason whenever either arm has no
  resolved high-risk doses (honest small-n handling).
- All outputs carry the bilingual disclaimer that demo behavioural data is
  pipeline validation, not clinical evidence (plan §18).

## 8. Status in this deployment

- ✅ Arms, gating, ledger, export, and outcome analysis implemented and
  browser-verified (Intelligence page → "Controlled Study" panel).
- ✅ Shadow mode active (`SMART_REMINDERS=shadow`); flipping to `live`
  activates delivery with the same gating.
- ⛔ Not performed: enrollment of real participants (requires the ethics
  prerequisites above). Current numbers come from a single demo user.

## 9. Threats to validity (documented, not hidden)

- Single-user demo data; tiny n; positive-skewed temporal test split.
- The demo user's arm was reassigned during verification (`reason:
  "operator"`), then restored to `control`.
- Snooze/skip are user actions available to both arms and are recorded in
  the ledger for adjustment.
