# MedSync AI — API Reference (this rebuild)

> All routes are same-origin relative paths on port 3000 (through the
> sandbox gateway). **Authentication** (Phase 12): every user-data route
> requires either `Authorization: Bearer <jwt>` or the HttpOnly
> `medsync_token` cookie set at login. Routes that accept an explicit
> userId (query/param/body) enforce that it equals the authenticated
> caller (401 unauthenticated / 403 foreign id).
> Conventions: JSON bodies unless noted; `✱` = new or changed in the
> Phase 3/12/4/5 session (2026-09-27).
> **Added 2026-10-01 (Master Review 100 sync) — v5 endpoints not previously
> listed here:**
>
> | Method | Path | Notes |
> |---|---|---|
> | POST | `/api/auth/logout` | Clears cookie; `{allDevices:true}` bumps `tokenVersion` (invalidates every token) |
> | GET/POST/DELETE | `/api/study/consent` | In-app research consent lifecycle (version/timestamps/revocation; idempotent) |
> | GET | `/api/research/overview` | De-identified research dashboard aggregates (participants/doses/risk/dataQuality/ai) |
> | POST | `/api/agents/feedback` | AI answer rating upsert `{agent, rating: helpful\|unhelpful\|unsafe, aiLogId?, comment?}` (30/10min) |
> | GET/POST/DELETE | `/api/agents/conversations` | Conversation 2.0 threads (`?agent=` list, `?id=` load/delete; scoped to caller) |
> | POST | `/api/agents` | **AI Gateway** — the primary chat entry (`{input, language, preferredAgent?, conversationId?}`); direct specialist routes (`/api/agents/medical\|medicine\|personal-health\|emergency`) share the same safety/verification/audit and are now ALSO budget-guarded (429 AI_BUDGET_EXCEEDED) and context-fed |
> | POST | `/api/agents/vision` | Image analysis (multipart `image` + `mode=medication\|report`); mandatory verification notice |
> | POST | `/api/medicine/delete\|update\|list` | Medication lifecycle (cascade delete, partial update + reschedule, full localized list) |
> | POST | `/api/preferences/timezone` | Timezone change (rebuilds future scheduler window) |
> | GET | `/api/languages/supported` · `/api/languages/user` | Language list + per-user preference |

## Health & observability

| Method | Path | Notes |
|---|---|---|
| GET | `/api/healthz` | Liveness + AI provider status (`aiProviders`) |
| GET | `/api/readyz` | DB `SELECT 1` + ML registry + DoseEvent store (503 on failure) |
| GET | `/api/metrics` | p50/p95/p99 latency percentiles per instrumented route |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | `{name,email,password,timeZone?✱}` | Creates unverified user + OTP (sandbox returns `demoOtp`); stores validated IANA `timeZone` |
| POST | `/api/auth/verify-otp` | `{email,otp,timeZone?✱}` | Verifies, returns `{token,user,backupCodes}`; **sets HttpOnly cookie✱**; crypto-random backup codes✱ |
| POST | `/api/auth/resend-otp` | `{email}` | New OTP, resets attempt counter |
| POST | `/api/auth/login` | `{email,password,timeZone?✱}` | `{token,user}`; **sets HttpOnly cookie✱**; applies the client timezone safely✱ |
| POST | `/api/auth/google` | `{credential}` | Credential-gated stub (no GOOGLE_CLIENT_ID in this build) |
| GET | `/api/oauth/login` | — | 503 stub (calendar OAuth not configured) |

## Medications & doses

| Method | Path | Body / Query | Notes |
|---|---|---|---|
| POST | `/api/medicine/today` | `{}` (auth) | Today's meds; **"today" in the user's timezone✱**; localized instructions |
| POST | `/api/medicine/list` | `{}` (auth) | **All** meds of the caller (same shape as /today + `scheduledToday` flag) — management view |
| POST | `/api/medicine/add` | `{medication:{...}, localuser?}` | Safety-shield interaction check (409 on major interaction unless `overrideInteractionWarning`) |
| POST | `/api/medicine/update` | `{medId, updates:{...}, overrideInteractionWarning?}` | Partial edit; rename re-runs the interaction shield (409); description change re-translates to AR; schedule change re-materializes future pending DoseEvents (history preserved) |
| POST | `/api/medicine/delete` | `{medId}` | **Cascade delete**: DoseEvents → SmartReminders → RiskPredictions → medication; returns per-table removed counts |
| POST | `/api/medicine/bulk` | `{text}` | Bulk parser |
| POST | `/api/medicine/status` | `{medId,dosageTimeIndex?,status}` | Marks dose; dual-writes DoseEvent (tz-aware✱) |
| POST | `/api/medicine/check-interactions` | `{pillName}` | Curated interaction table |
| GET | `/api/dose-events` | `?range=today\|upcoming\|history&hours&limit` | **"today" in the user's timezone✱**; BOLA-guarded✱ |
| POST | `/api/dose-events` | `{action:prepare\|migrate\|materialize}` | MEDSYNC-003 pipeline for the caller |
| POST | `/api/dose-events/snooze` | `{doseEventId,minutes?}` | plan §11; delivers even in shadow mode |
| POST | `/api/dose-events/skip` | `{doseEventId,reason}` | reason ∈ forgot/not_needed/doctor/side_effects/other |

## Analytics & intelligence

| Method | Path | Notes |
|---|---|---|
| GET | `/api/analytics/[userId]?days=7\|30\|90` | ✱ **Analytics 2.0 (rewritten on DoseEvent)**: legacy shape (`taken/missed/delayed/pending/byDay`) + `confirmationRate, onTimeRate, avgDelayMinutes, skipped, resolved, confirmed, currentStreakDays, longestStreakDays, byHour, byMedication, reminderResponse{samples,medianMinutes,avgMinutes}, timeZone, windowDays`. All buckets in the user's timezone. |
| GET | `/api/intelligence/overview` | Single-call feed: adherence summary, 48h risk forecast with explanations, model + candidates, study arm, reminder ledger |
| POST | `/api/streak` | Consecutive fully-adherent days (tz-aware day boundaries✱) |

## ML (plan §16–22)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ml/status` | Registry: active model, all artifacts, engine mode |
| POST | `/api/ml/train` | Trains baseline/LR/GB/RF on the same temporal split; evidence-based promotion; ✱ **exports `ml-artifacts/model_metadata.json`** (Phase 5) |

## Study (plan §24–32)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/study/status` | Caller's arm + enrollment snapshot |
| GET | `/api/study/outcomes` | Wilson/Newcombe 95% CIs, integrity check (controlExtraSent=0) |
| GET | `/api/study/export?all=1&format=json` | Pseudonymized CSV/JSON research export (authenticated) |
| POST | `/api/study/assign` | Operator: `{arm:"control"\|"smart"}` for the caller |

## Engine

| Method | Path | Notes |
|---|---|---|
| POST | `/api/reminder-engine/tick` | `{userId?}` scopes to caller; `{all:true}` runs the global tick (same as the 60s background loop) |
| POST | `/api/notification/regular-notify` | Engine tick for the caller, legacy `{scheduled}` contract |
| POST | `/api/notification/today` | Today's DailyNotification list (tz-aware day key✱) |

## Reports & AI agents (all BOLA-guarded✱; agents answer as the verified caller)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/report` | Adherence PDF report for the caller |
| POST | `/api/report/analyze` | multipart `file` (≤10 MB, PDF/plain text✱) + `language?`; returns analysis + readability + reportId |
| POST | `/api/report/chat` | `{question,reportId,language?}` — grounded Q&A, owner-checked |
| GET | `/api/report/[id]/readability` · `/api/report/[id]/translate/[lang]` | Owner-checked |
| POST | `/api/agents` | ✱ Phase 8 AIRouter: `{input,language?}` — deterministic server-side intent classification (emergency > personal-health > medicine > medical); response adds `routedTo` + `router{mechanism,rule,matched}`; emergency replies always end with the fixed bilingual escalation line (enforced server-side) |
| POST | `/api/agents/medical\|medicine\|emergency\|personal-health` | `{input,user?,language?}` — Groq→Gemini→z-ai chain (explicit agent selection still available; the client's default is the router) |
| POST | `/api/agents/reports` | Lists the caller's stored reports |
| POST | `/api/translate` · `/api/translate/batch` | Translation service |

## Preferences

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `/api/preferences` | Reading/translation preferences |
| POST | `/api/preferences/reset` | Reset to defaults |
| GET/PUT | `/api/preferences/timezone` | ✱ Phase 3: read / safely apply the user's IANA timezone (rebuilds only future pending scheduler rows; history never rewritten) |
| GET/PUT | `/api/languages/user` | Preferred language (caller-scoped✱) |
| GET | `/api/languages/supported` · `/api/translate/supported` | Static lists |
| GET/PUT | `/api/health` | Health profile (token-scoped) |
| GET/POST | `/api/calendar/status` · `/api/calendar/sync` | Calendar linking (credential-gated) |

---

## AI Gateway endpoints (2026-09-29 — multi-agent architecture spec)

### `POST /api/agents` — AI Gateway (THE conversational entry)
Auth: required (Bearer or cookie). Body: `{ input, language?, preferredAgent? }`.
Pipeline: safety router (emergency keywords always win) → intent classifier →
context builder (permitted tools only) → specialist module → output validator
(handoff QUESTION-FIRST, one hop) → AiLog audit.
Response (additive over the legacy shape): `{ success, output, routedTo,
handoffFrom, intent, severity?, confidence, warnings, needs_handoff,
handoff_agent, provider, model, fallbackUsed, toolCalls, requestId, latencyMs,
router: { mechanism, rule, matched, emergencyEscalationAppended, safetyResult } }`.
`preferredAgent` is a HINT — safety and data-ownership keywords override it (§50).

### `POST /api/agents/vision` — image pipeline
Auth: required. multipart/form-data: `image` (PNG/JPEG/WebP ≤10MB), `mode`
(`medication`|`report`), `language`.
Vision chain: Gemini direct → z-ai gateway VLM (never a text-only model).
Medication mode: structured extraction → interaction check under the medicine
agent's tool permissions → Medication Specialist explanation. Report mode:
OCR extraction → Medical Knowledge summary (no final diagnosis).
Always returns the bilingual verification notice + `confidence:
"needs_verification"` (§52). 415 non-image, 413 oversize, 502 chain-failure
("enter the medicine name manually" — never a guess).

### `GET /api/ai-monitoring?hours=168` — monitoring feed
Auth: required. Aggregates AiLog per agent (requests, successRate,
fallbackRate, avg/p95 latency, handoffs, safetyBlocks, emergencyPriorities)
+ current provider-chain config + capabilities matrix + 40 recent entries.
Data-minimized: no medical text is stored or returned.

### Direct specialist routes (unchanged contracts, audited)
`POST /api/agents/{medical,medicine,personal-health,emergency}` — same bodies
as before; now wrapped with gateway safety (emergency override), handoff
detection (`needs_handoff`/`handoff_agent` when the answer is a redirection)
and AiLog audit. `provider`/`model` metadata added to every agent response.
