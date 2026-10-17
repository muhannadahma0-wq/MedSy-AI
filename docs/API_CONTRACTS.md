# API_CONTRACTS.md — 62-Route Migration Matrix

**Owner:** Agent 1 (matrix) / Agent 3 (Express mounting) / Agent 6 (verification)
**Strategy (ADR-02):** all handlers are mounted path-for-path in Express via the web-compat shim — request/response contracts are preserved verbatim. The "target" column is therefore the same path in `migration/server`; the matrix records auth + notes + verification hooks.

Auth legend: **JWT** = `requireSelf`/`getAuthUser` (Bearer or `medsync_token` cookie); **public** = no auth; **bridge** = internal signed call.

## Authentication & account (6)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/auth/signup` | POST | public | OTP flow; rate-limited |
| `/api/auth/login` | POST | public | sets HttpOnly cookie; account-status check |
| `/api/auth/verify-otp` | POST | public | cooldown enforced |
| `/api/auth/resend-otp` | POST | public | 429 on cooldown (P0-13) |
| `/api/auth/logout` | POST | JWT | clears cookie; `allDevices` bumps tokenVersion (P0-08) |
| `/api/auth/google` | POST | public | Google credential exchange |

## Medications & interactions (8)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/medicine/add` | POST | JWT | pillName validation (F-10) |
| `/api/medicine/list` | POST | JWT | |
| `/api/medicine/today` | POST | JWT | |
| `/api/medicine/update` | POST | JWT | |
| `/api/medicine/delete` | POST | JWT | cascade incl. RiskPredictions (transactional) |
| `/api/medicine/bulk` | POST | JWT | per-item interaction screening (F-11) |
| `/api/medicine/status` | POST | JWT | |
| `/api/medicine/check-interactions` | POST | JWT | requireSelf (F-04) |

## Dose events & adherence (5)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/dose-events` | GET, POST | JWT | |
| `/api/dose-events/skip` | POST | JWT | async-compiled (F-02) |
| `/api/dose-events/snooze` | POST | JWT | |
| `/api/streak` | POST | JWT | today-bucket skip fix (F-12) |
| `/api/analytics/[userId]` | GET | JWT (self) | Analytics 2.0 on DoseEvent; dynamic param |

## AI agents & conversations (11)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/agents` | POST | JWT | AI Gateway entry; budgets; conversation threads |
| `/api/agents/chat` | POST | JWT | legacy alias |
| `/api/agents/medical` | POST | JWT | direct specialist (budget-wrapped, F-06) |
| `/api/agents/medicine` | POST | JWT | direct; med context always injected (F-01) |
| `/api/agents/personal-health` | POST | JWT | direct; tools restricted |
| `/api/agents/emergency` | POST | JWT | direct; escalation guarantee |
| `/api/agents/reports` | POST | JWT | direct report-analysis agent |
| `/api/agents/vision` | POST | JWT | multipart upload; type/size validated |
| `/api/agents/feedback` | POST | JWT | |
| `/api/agents/conversations` | GET, DELETE | JWT | ownership enforced; `[id]` subresource in same file contract |
| `/api/ai-monitoring` | GET | JWT | provider chains, breaker health |

## Reports, translation, readability (7)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/report` | POST | JWT | PDF upload + list |
| `/api/report/analyze` | POST | JWT | prompt-injection delimited (P0-31..34) |
| `/api/report/chat` | POST | JWT | |
| `/api/report/[id]/readability` | GET | JWT (self) | dynamic param |
| `/api/report/[id]/translate/[language]` | GET | JWT (self) | dynamic params |
| `/api/translate` | POST | JWT | medical translation |
| `/api/translate/batch` | POST | JWT | |
| `/api/translate/supported` | GET | public | |

## ML & intelligence (4)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/ml/status` | GET | JWT | active artifact + metrics |
| `/api/ml/train` | POST | JWT | temporal-split training; artifact promotion |
| `/api/intelligence/overview` | GET | JWT | |
| `/api/metrics` | GET | public | app metrics (no PII) |

## Study & research (7)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/study/assign` | POST | JWT | arm assignment |
| `/api/study/status` | GET | JWT | |
| `/api/study/consent` | GET, POST, DELETE | JWT | consent-gated escalation (F-07) |
| `/api/study/outcomes` | GET | JWT | Wilson/Newcombe intervals |
| `/api/study/export` | GET | JWT | 19-column PII-free CSV |
| `/api/research/overview` | GET | JWT | |
| `/api/notification/*` (today, regular-notify) | POST | JWT | notification surfaces |

## Preferences, languages, calendar (7)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/preferences` | GET, PUT | JWT (self) | requireSelf (F-04) |
| `/api/preferences/reset` | POST | JWT (self) | |
| `/api/preferences/timezone` | GET, PUT | JWT | tz change → DoseEvent re-materialization |
| `/api/languages/supported` | GET | public | EN/AR |
| `/api/languages/user` | GET, PUT | JWT | |
| `/api/calendar/sync` | POST | JWT (self) | graceful no-token path |
| `/api/calendar/status` | POST | JWT (self) | |
| `/api/oauth/login` | GET | public | OAuth entry |

## Health & ops (4)
| Source route | Methods | Auth | Notes |
|---|---|---|---|
| `/api/healthz` | GET | public | honest provider flags (`zaiGlm`, F-17) |
| `/api/readyz` | GET | public | readiness incl. DB |
| `/api/health` | GET, POST | JWT (self) | health profile |
| `/api/reminder-engine/tick` | POST | bridge/protected | manual engine tick |

**Totals:** 62 route files · 3 dynamic · 75 HTTP method bindings (per-file exports measured P0). Contract source: the handlers themselves (ADR-02 — verbatim mounting); documented changes: none.

## Shared service layer (copied verbatim, `migration/server/src/lib`)

`db.ts` (Prisma) · `server/jwt.ts` (HS256 + tokenVersion) · `server/http.ts` (json/readJson/apiError) · `server/metrics.ts` · `server/rate-limit.ts` · `server/ai/*` (registry, gateway, tools, providers) · `server/models/*` (4 per-agent modules + zai-fallback) · `server/reminder-engine.ts` · `server/notifications.ts` (HMAC bridge) · `server/adherence-engine.ts` · `server/ml/*` · `server/report-analysis.ts` · `server/translation.ts` · `server/readability.ts` · `server/medical-terminology.ts` · `server/drug-interactions.ts` · `server/tz.ts` · data/research libs.
