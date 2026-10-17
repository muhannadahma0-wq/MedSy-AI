# MedSync-AI — Intelligent Medication Adherence Platform

> A graduation research project: **adaptive** medication reminders driven by machine learning that predicts
> the risk of missing each individual dose, **four separate AI agents** (each with its own model and settings),
> **bilingual support (EN/AR with full RTL)**, and a **controlled-study platform** for measuring the intervention's effect.

See also: [`QUICKSTART.md`](QUICKSTART.md) for setup and [`DEPLOY.md`](DEPLOY.md) for deploying on Render.

---

## At a glance

| | |
|---|---|
| **Frontend** | Original React 19 code (15 pages) inside Next.js 16 — a single page `/` using HashRouter |
| **Backend** | 30+ API routes (Next.js Route Handlers) mirroring the original Express API 1:1 |
| **Data** | Prisma ORM + SQLite — 12 models (User, Medication, DoseEvent, SmartReminder, RiskPrediction, ModelArtifact, StudyAssignment…) |
| **Real time** | Socket.IO mini-service (3003) + emit bridge (3004) — one room per user, JWT in the handshake |
| **AI** | Every agent is an independent module: its own ChatGroq + its own Gemini instance + a z-ai (GLM) fallback — **no shared llm.ts** |
| **Security** | Deterministic server-side identity on every protected route (`requireSelf`: token → account exists → active → tokenVersion) + BOLA guards + rate limits + HttpOnly cookie + SHA-256-hashed backup codes + safe error contract |
| **Offline** | IndexedDB queue → replay with exponential backoff → dead-letter → visible status badge |

**Platform state (2026-10-17):** 19 users · 41 medications · 1,856 dose events · 1,113 risk predictions ·
active model: Logistic Regression (ROC-AUC 0.6926 / PR-AUC 0.7697 / Brier 0.2165, temporal validation n=325) ·
study arms 6/7 · data checks 9/9 ALL PASSED · lint 0/0 · full review battery: 350 test checks, all green.

## AI agents (separate architecture, as in the original project)

```
AI GATEWAY (/api/agents) — safety router ← intent ← context (authorized tools) ← specialist ← output validation
  medical-model.ts      →  Groq gpt-oss-120b   +  own Gemini  +  z-ai   (medical knowledge)
  emergency-model.ts    →  Groq gpt-oss-120b   +  own Gemini  +  z-ai   (emergency triage — guaranteed escalation + severity grading)
  medicine-model.ts     →  Groq gpt-oss-120b   +  own Gemini  +  z-ai   (medication specialist)
  personal-health-model →  Groq gpt-oss-120b   +  own Gemini  +  z-ai   (personal health — the only agent with data tools)
  report-analysis.ts    →  Groq gpt-oss-120b   +  z-ai                    (report analysis)
  translation.ts        →  own Gemini + z-ai                              (medical translation)
VISION (/api/agents/vision) → Gemini Vision ← z-ai VLM — medication/report images with a mandatory verification notice
MONITORING (#/ai-monitoring) → per-agent statistics + permission matrix + provider chains
```

Each agent has conversation threads stored in the database per (user, agent, conversation) with a rolling
summary, the verbatim prompt from the original repository, and a tiered provider chain that is configurable
from `.env` only (`MEDICAL_PRIMARY=...`, `VISION_PRIMARY=...`). **The medication specialist always knows the
caller's medications** (their medication list and interaction screen are injected into its context on every
question — via the gateway and the direct route). Tools are enforced in code (not just in the prompt): each
agent sees only the data it is allowed to see.
Full details: [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md).

## Security architecture (full audit, 2026-09-29)

> The platform underwent a comprehensive security audit (73 findings) on 2026-09-29. Key guarantees now in place:

- **Deterministic server-side identity on every protected route:** an async `requireSelf` checks in order: valid
  token → account exists → status is `active` → `tokenVersion` matches → BOLA check on the requested identifier.
- **Rate limits:** sliding windows on login/signup/verify-otp/resend-otp/google (429 + `Retry-After`),
  plus a 60-second per-account cooldown on OTP resend.
- **Socket rooms from verified identity only:** the token is accepted from `handshake.auth` exclusively
  (query tokens are rejected); rooms are derived from the verified token identity — a user joining another
  user's room is rejected and logged.
- **Backup codes:** crypto-random and stored as SHA-256 (the plaintext is shown once).
- **Controlled error contract:** authentication 500s return a uniform `INTERNAL_ERROR` — raw exception text is never exposed.
- **Session versioning + logout:** bumping `User.tokenVersion` invalidates all of an account's tokens;
  `POST /api/auth/logout` always clears the cookie and, with `{allDevices:true}`, revokes every session immediately.
- **Report upload:** PDF magic-byte check + per-user rate limit (10 per 10 minutes) + document content wrapped
  as UNTRUSTED DATA against prompt injection.

## Model registry

Every agent keeps its own instances (separation preserved) and a model that can be overridden from `.env`
**per agent** (defaults after replacing the retired llama-3.3-70b / llama-4-scout models on 2026-09-29):

| Agent | Answer model (default, overridable from `.env`) |
|-------|-------------------------------------------------|
| Medical knowledge | `MEDICAL_CHAT_MODEL` (`MEDICAL_*` chain) |
| Medication specialist | `MEDICATION_CHAT_MODEL` (`MEDICATION_*` chain) |
| Personal health | `PERSONAL_CHAT_MODEL` (`PERSONAL_*` chain) |
| Emergency triage | `EMERGENCY_CHAT_MODEL` (`EMERGENCY_*` chain) |
| Report analysis | `REPORT_CHAT_MODEL` (dedicated hard chain groq→zai) |
| Gateway (providers.ts) | `GROQ_CHAT_MODEL` |

> `*_SUMMARY_MODEL` variables were removed in v5 (the rolling summary is now a text merge with no LLM).

- **Provider chain** groq → gemini → z-ai per agent: per-call timeout (45 s text / 90 s vision) plus an in-memory
  circuit breaker (3 failures → open for 60 s → half-open probe), with its state exposed at `/api/ai-monitoring` (providerHealth).
- **Honest naming:** the z-ai gateway serves GLM from Zhipu AI (and is named as such everywhere).
- **Network note:** the preview environment's network is geo-blocked from Groq/Gemini, so the chain answers via z-ai;
  when deployed from a supported network, Groq/Gemini take over automatically with no code change.

## Running locally

```bash
cp .env.example .env # then fill in your own values
bun install          # dependencies
bun run db:push      # Prisma schema → SQLite
bun run dev          # server (port 3000)
# + Socket service:
cd mini-services/socket-service && bun run dev   # (3003 + bridge 3004)
```

**Demo account:** `demo@medsync.ai` / `demo1234` (hint shown on the login screen).
> A sandbox demo fixture — synthetic data only; rotate it before any real deployment.

## Verify it yourself

```bash
bun run scripts/verify-data.ts      # data integrity — 9 checks (must be: ALL PASSED)
bun run scripts/test-security.ts    # auth/session/socket security — 23 checks (must be 23/23, including rejection of an unsigned /emit bridge call)
bun run scripts/test-full-site.ts   # full-site suite — 56 checks across all API routes (must be 56/56; self-cleaning, also cleans RiskPrediction/SmartReminder records)
bun run scripts/test-med-crud.ts    # medication lifecycle — delete/edit/full list + BOLA + interaction shield (must be 40/40)
bun run scripts/test-agent-suite.ts # AI gateway — 25 routing/safety/security checks (must be 25/25)
bun run scripts/state-snapshot.ts   # live platform state
bun run scripts/provider-probe.ts   # which LLM provider is actually answering
bun run lint                        # 0 errors / 0 warnings
```

> Note: `test-agents.ts` (the six agents + translation) is covered by the newer, broader `test-full-site.ts` suite.
>
> **Last verification: 2026-10-01 (the major full review — 20 review agents × 100 tasks):**
> security 23/23 · AI gateway 25/25 · data integrity 9/9 ALL PASSED · medication lifecycle 40/40 · conversations 44/44 ·
> conversation+budget units 32/32 · search 48/48 · notification localization 48/48 · golden path 34/34 ·
> full site 56/56 · lint 0/0 — **350 checks in total, all green**, plus live verification that the medication
> specialist mentions the caller's medications in general questions (Arabic/English, gateway and direct route).

## Documentation (docs/)

| Document | Contents |
|----------|----------|
| [AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) | **Specialist agent architecture** — gateway, safety, tools, vision, monitoring |
| [SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md) | Honest security assessment (authentication, BOLA, declared gaps) |
| [API.md](docs/API.md) | Endpoint reference + authentication contract |
| [ML_DESIGN.md](docs/ML_DESIGN.md) | ML pipeline design (features, honest labeling, evidence-based promotion) |
| [STUDY_PROTOCOL.md](docs/STUDY_PROTOCOL.md) | Study protocol (arms, sample sizes, ethics) |
| [OFFLINE_SYNC.md](docs/OFFLINE_SYNC.md) | Offline sync + conflict policy |
| [ADHERENCE_PLATFORM.md](docs/ADHERENCE_PLATFORM.md) | End-to-end adherence platform architecture |
| [LIMITATIONS.md](docs/LIMITATIONS.md) · [DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md) | Declared limits · deployment guide |

## Research honesty contract

- Results are on **synthetic data** (12 behavioral personas) and are never presented as clinical evidence.
- The honest term is "not confirmed", not "non-adherence" (the patient may have taken the dose without logging it).
- Validation is **temporal only**; accuracy alone is never used for judgment.
- Every AI provider is named for what it really is (the z-ai gateway = GLM from Zhipu AI, not Gemini).
- Every "completed" phase is backed by a traceable record; every deferral states its reason.

---

**Research contribution:** RQ1 (risk prediction — ROC-AUC 0.6926 with temporal validation) · RQ2 (intervention
effect — platform ready, awaiting ethics approval) · RQ3 (reliability — measured in practice) · RQ4 (multilingual
accessibility — verified live in Arabic RTL).
