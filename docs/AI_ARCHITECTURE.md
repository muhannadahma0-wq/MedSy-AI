# MedSync AI — Specialist Agent Architecture (AI Architecture)

| Metadata | Value |
|---|---|
| **Architecture Version** | 2.0.0 |
| **Last Verified** | 2026-09-29 |
| **Safety Policy Version** | `2026-09-29.1` (`SAFETY_RULES_VERSION`, extensible via `EMERGENCY_KEYWORDS_EXTRA` / `URGENT_KEYWORDS_EXTRA`) |
| **Agent Version** | 2.0.0 (returned in every gateway response) |
| **API surface** | `/api/agents` (gateway) · `/api/agents/{medical,medicine,personal-health,emergency,vision,chat,reports}` · `/api/ai-monitoring` |
| **DB schema** | `prisma/schema.prisma` (`User.status` / `User.tokenVersion` added on 2026-09-29) |

> **Reference:** the owner's specification (55 sections, 2026-09-29) — "4 specialists + Router + Safety Gateway +
> Vision Pipeline + Provider Abstraction + Tool Permissions + Handoff + Output Validation +
> Fallback — not 4 chatbots".
> This document records **what was actually implemented** and where it lives in the code, and keeps the honesty
> contract: anything not implemented is stated explicitly.

---

## 1. Implemented architecture (§53)

```
                         USER
                           │
                  ┌────────▼────────┐
                  │   AI GATEWAY    │  src/lib/server/ai/gateway.ts
                  │  POST /api/agents│
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │ SAFETY ROUTER   │  safetyCheck() — emergency/urgent keywords
                  └────────┬────────┘  (bilingual EN/AR, deterministic;
                                     SAFETY_RULES_VERSION 2026-09-29.1,
                                     keyword lists extensible from env)
               ┌───────────┴───────────┐
          Emergency?                 No
               │                       │
               ▼                       ▼
       Emergency Agent          INTENT CLASSIFIER  classifyIntent()
       + severity tier          (personal-history > lifestyle > medicine > medical)
       + escalation line               │
       + locale-aware number           │
         (timezone → 101/911/112)
              ┌────────────────────────┼────────────────────┐
              ▼                        ▼                    ▼
       Medical Agent          Medication Agent      Personal Health
       (own module)           (own module)          (own module + tools)
              │                        │                    │
              └────────────────────────┼────────────────────┘
                                       │
                              CONTEXT BUILDER  buildContext()
                              (permitted tools only, per question)
                                       │
                              VERIFICATION GATE (P0-43 — deterministic)
                              certainty-violation correction, injection
                              markers, internal-id warnings + handoff
                              QUESTION-FIRST, escalation, severity
                              (result → AiLog safetyResult
                              as |verify:pass|warnings|corrected)
                                       │
                              AiLog (data-minimized audit)
                                       │
                                  USER RESPONSE

  Image/PDF:  POST /api/agents/vision
              File Validator → Vision chain (Gemini → z-ai VLM)
              → Structured extraction → Correct Specialist → Verify notice

  Monitoring: GET /api/ai-monitoring → #/ai-monitoring page
```

## 2. File map

| Component | File | Role |
|---------|-------|---------|
| **AI gateway** | `src/lib/server/ai/gateway.ts` | safetyCheck + classifyIntent + buildContext + agent execution + output verification + single-hop handoff + AiLog |
| **Agent registry** | `src/lib/server/ai/agent-registry.ts` | Capability matrix (§19), per-agent tool permissions (§20-21), allowed handoff targets (§24-26), handoff language patterns |
| **Tool layer** | `src/lib/server/ai/tools.ts` | 6 tools with authorization enforced in code (assertPermission before any data): getMedications / checkInteractions / getDoseHistory / getAdherenceSummary / getHealthProfile / getStoredRiskExplanation |
| **Provider abstraction** | `src/lib/server/ai/providers.ts` | ModelProvider interface (generate + analyzeImage), groq/gemini/zai registry, chains from env (§54), runProviderChain (§30: same agent + different provider) |
| **Vision pipeline** | `src/app/api/agents/vision/route.ts` | Medication/report images: file validation → injection-protected structured extraction → correct specialist → verification notice (§52) |
| **Monitoring** | `src/app/api/ai-monitoring/route.ts` + `src/pages/aiMonitoring.jsx` | Per-agent statistics: requests/success/fallback/p95 latency/handoffs/safety interventions + capability matrix + current provider chains |
| **UI** | `src/pages/agents.jsx` | 6 options per §50 (4 specialists via the preferredAgent hint + report analysis + image upload), preview+mode modal (§51), vision result panel + verification notice (§52), severity/handoff badges |
| **Tests** | `scripts/test-agent-suite.ts` | TEST-MED-001/002, TEST-PH-001, TEST-ER-001, TEST-ROUTER-AR, TEST-URGENT, TEST-SAFETY-PREF, TEST-HANDOFF, TEST-SEC-001/002/003, TEST-MON-001 — **25/25 PASS** |
| **Audit log** | `prisma/schema.prisma` → `AiLog` | requestId/user/agent/provider/model/intent/severity/fallbackUsed/handoff/safetyResult/toolCalls/latencyMs — **no full medical text** (§35 data minimization) |

## 3. Hard rules — how they are enforced

| Rule (section) | Implementation in code |
|---|---|
| Emergency always first (§23, §41) | `safetyCheck()` runs before anything else; even `preferredAgent` cannot bypass it — direct routes too (`wrapDirectAgentCall` redirects to emergency) |
| No agent answers everything (§6, §25-26) | Boundaries live in the original prompt (verbatim transfer) + detection of handoff markers in outputs + automatic single-hop handoff THROUGH the router |
| Handoff only via the router (§24) | `runGateway` performs the hop — there is no direct agent-to-agent call |
| Protection in code, not only in the prompt (§21) | `assertPermission` before every tool; denials are logged (`safetyResult: tool_denied`) |
| Context filtering (§36-37) | `buildContext` selects tools by the question's keywords — it never sends everything |
| ML is not an agent (§42-44) | `getStoredRiskExplanation` reads only the **stored** prediction; the LLM explains and never recomputes |
| Images never go to a text-only model (§17, §31) | `supportsVision` in the interface — Groq skips images automatically; VISION chain: gemini→zai |
| Prompt injection (§40) | Explicit security instruction + extracted content is passed as DATA inside delimiters, never as a system instruction |
| Visual recognition is not proof (§52) | Bilingual verification notice on every vision response + `confidence: "needs_verification"` (§32) |
| Fallback does not change the specialty (§30) | The four modules keep their prompts; the chain inside a module replays the same prompt to another provider |
| Safe refusal when all providers fail (§29, §31) | A "enter the medication name manually" message — never a guess |
| User preference never overrides the router (§50) | `preferredAgent` is a hint; the router corrects it: emergency always wins, and data-ownership phrases ("my adherence") are corrected to Personal Health |

## 4. Model routing — configuration only (§54)

`.env` (current values):
```env
MEDICAL_PRIMARY=groq        MEDICAL_SECONDARY=gemini   MEDICAL_FALLBACK=zai
MEDICATION_PRIMARY=groq     MEDICATION_SECONDARY=gemini MEDICATION_FALLBACK=zai
PERSONAL_PRIMARY=groq       PERSONAL_SECONDARY=gemini   PERSONAL_FALLBACK=zai
EMERGENCY_PRIMARY=groq      EMERGENCY_SECONDARY=gemini  EMERGENCY_FALLBACK=zai
VISION_PRIMARY=gemini       VISION_FALLBACK=zai
# Models — per agent (P0-17/18: the retired llama-3.3-70b/llama-4-scout were replaced on 2026-09-29):
MEDICAL_CHAT_MODEL=openai/gpt-oss-120b       MEDICAL_SUMMARY_MODEL=openai/gpt-oss-20b
MEDICATION_CHAT_MODEL=openai/gpt-oss-120b    MEDICATION_SUMMARY_MODEL=openai/gpt-oss-20b
PERSONAL_CHAT_MODEL=openai/gpt-oss-120b      PERSONAL_SUMMARY_MODEL=openai/gpt-oss-20b
EMERGENCY_CHAT_MODEL=openai/gpt-oss-120b     EMERGENCY_SUMMARY_MODEL=openai/gpt-oss-20b
REPORT_CHAT_MODEL=openai/gpt-oss-120b
GROQ_CHAT_MODEL=openai/gpt-oss-120b          # the groq model in the shared providers.ts layer
```
Changing a model/provider **requires no change to any agent or the UI** — every model identifier can be
overridden from `.env` **per agent** (separation preserved: each agent has its own instances). The two retired
models `llama-3.3-70b-versatile` and `meta-llama/llama-4-scout-17b-16e-instruct` were replaced in the
2026-09-29 audit with `openai/gpt-oss-120b` (answers) and `openai/gpt-oss-20b` (summaries)
(`scripts/modernize-agents.ts` records the migration). Note: the `*_SUMMARY_MODEL` variables were later removed (v5).

**Reliability (P1-44/45):** per-call timeout (45 s text / 90 s vision) + an in-memory circuit breaker
(3 failures → open for 60 s → half-open probe) — state exposed via `providerHealth()` in
`/api/ai-monitoring`; every API route returns an `x-request-id` header from `withMetrics`.

**Current network status (tested):** the Groq/Google keys are valid but the preview environment's network is
geo-blocked from both → the chain answers via z-ai (GLM). When deployed from a supported network,
Groq/Gemini take over automatically with no change.

## 5. Capability matrix (§19)

Shown live on the monitoring page (`capabilitiesMatrix` from `agent-registry.ts`):
10 capabilities × 4 agents (full/limited/none/handoff/owner_only) — matches the specification table verbatim,
including the two always-refused rows: **changing medications ✗** and **diagnosing diseases ✗** for all agents.

## 6. Structured output (§28)

Every gateway response carries (in addition to the `output` that stays compatible with the existing UI):
```json
{
  "routedTo": "personal-health", "handoffFrom": "medicine",
  "intent": "PERSONAL_HEALTH", "severity": null,
  "confidence": "high|medium|needs_verification",
  "needs_handoff": false, "handoff_agent": null,
  "provider": "zai-glm", "model": "GLM (z-ai gateway)", "fallbackUsed": true,
  "toolCalls": ["getAdherenceSummary", "getDoseHistory"],
  "requestId": "…", "latencyMs": 1166,
  "router": { "mechanism": "…", "rule": "…", "matched": ["…"], "safetyResult": "ok" }
}
```

**2026-09-29 audit additions (version 2.0.0):** extra structured fields — `actions`, `uncertainty`,
`needsProfessionalReview`, `verification` + `agentVersion: "2.0.0"`, `policyVersion`
(SAFETY_RULES_VERSION) and `modelVersion`; the deterministic verification gate's decision is recorded in
`safetyResult` as `|verify:pass|warnings|corrected`.

## 7. Live test results (2026-09-29)

- **Test suite: 25/25 PASS** (EN+AR routing, personal tool with data, emergency with severity grading and
  escalation line, safety precedence over preference, handoff with two different flips, security:
  injection / no token / rejected file type, monitoring aggregates everything).
- **Security suite (full 2026-09-29 audit): 22/22 PASS** (`scripts/test-security.ts`): authentication matrix
  (anonymous / junk token / expired / deleted account / disabled account / mismatched tokenVersion), BOLA
  (report/medication/analytics of a foreign user), socket room isolation (the attacker's socket receives none of
  the victim's notifications), forged-PDF rejection (magic-byte check), rate limits, and logout revocation. Full
  regression afterwards: gateway 25/25 + data 9/9 + medication lifecycle 40/40 + full site 56/56 + clean browser E2E.
- **Vision E2E:** a generated Metformin 500mg box image → extraction `{drugName: "METFORMIN",
  strength: "500 mg"}` + drug interactions with the user's medications + medication specialist explanation +
  verification notice — in the UI and via curl.
- **Browser:** badges (Routed to / Redirected from / Severity) work, Arabic RTL with no overflow,
  mobile 390/390.

## 8. Not yet implemented (with reasons — honesty contract)

| Item | Reason |
|-------|-------|
| True function calling inside reasoning (the LLM decides the tool during generation) | The current implementation is a deterministic context builder — **safer and more auditable** (same philosophy as the §23 deterministic router). Upgrading later for supporting models is possible through the same tool layer |
| Image metadata stripping (EXIF) | Images are processed in memory and never stored; real cleaning needs an image library |
| External cited medical sources for every drug fact (§34 sources) | The static interaction table (18 pairs) cites a source per interaction; direct external sources are deferred |
| Qualitative evaluation of each agent's answer content (§46 quality criteria) | The §47 suite covers routing/safety/security; content-quality evaluation needs a human rubric set — required for the study |
| `/ai-monitoring` as an operator page with role management | The page is available to every authenticated user (see the note below) |

**Security note (honest):** `/api/ai-monitoring` currently exposes aggregate metrics across all users
(no medical content) to any authenticated user — acceptable for the development/demo phase, and it needs an
operator role restriction before any real deployment, as recorded in SECURITY_ASSESSMENT.

## 9. Re-verification commands

```bash
bun run scripts/test-agent-suite.ts    # 25 routing/safety/security checks — must be: 25/25
bun run scripts/test-security.ts       # 22 auth/socket security checks — must be: 22/22
bun run scripts/state-snapshot.ts      # platform state
curl -s localhost:3000/api/healthz     # AI providers
# Browser: #/agents (router + image upload) and #/ai-monitoring (monitoring)
```
