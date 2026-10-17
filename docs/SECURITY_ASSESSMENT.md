# Security Assessment — MedSync AI (this rebuild)

> Dedicated file per the master plan's Phase 18 documentation map. Status
> dates from the end of the Phase 3/12 session (2026-09-27). Every item is
> stated as verified-in-code + verified-live, or listed as an honest gap.
> The upstream MERN repo's fixes were re-audited against THIS codebase —
> several had regressed during the port and are fixed here.
>
> **UPDATE 2026-10-01 (Master Review 100 — full re-audit by 20 review agents,
> docs/MASTER_REVIEW_100.md — archived 2026-10-17, record kept in FULL_RECORD.md):** (1) `JWT_SECRET` is now a real random value in
> `.env` (was the documented sandbox fallback constant); (2) six remaining
> `getAuthUser` routes (preferences ×2, check-interactions, calendar ×2,
> health) upgraded to `requireSelf` — account-state + tokenVersion now
> enforced platform-wide; (3) 11 raw `(err as Error).message` leaks in 500
> responses replaced with safe contracts; (4) the socket `/emit` bridge on
> :3004 now REQUIRES an HMAC-SHA256 signature (timing-safe) — unsigned calls
> get 401 (new test, 23/23); (5) direct specialist agent routes are now
> budget-guarded like the gateway (429 AI_BUDGET_EXCEEDED); (6) medicine/add
> validates pillName (400) instead of leaking Prisma internals on 500;
> (7) bulk add screens drug interactions. The §5.5 "no rate limiter" note
> below was already stale (auth routes rate-limited since the 2026-09-29
> Master Audit). Remaining honest gaps are unchanged: socket handshake does
> not check tokenVersion (bounded by 1d expiry), PDFs served from public/
> without auth, sandbox OTP display.

## 1. Authentication

| Area | Status | Evidence / Notes |
|---|---|---|
| Password hashing | ✅ | scrypt KDF (`lib/server/password.ts`), timing-safe comparison |
| JWT | ✅ | HS256, 1-day expiry, timing-safe signature check (`lib/server/jwt.ts`) |
| OTP generation | ✅ **fixed this session** | `crypto.randomInt` (was `Math.random` — predictable, regressed in the port) |
| Backup codes | ✅ **fixed this session** | `crypto.randomBytes(4)` hex (was `Math.random().toString(36)`) |
| OTP attempt limit | ✅ | 5 attempts, then re-request required (`/api/auth/verify-otp`) |
| OTP expiry | ✅ | 10 minutes, checked server-side |
| **HttpOnly session cookie** | ✅ **added this session** | `medsync_token` (HttpOnly, SameSite=Lax, Path=/, 1d) set by login / verify-otp. `getAuthUser` accepts Bearer **or** cookie. Live-verified: medicine/today and intelligence/overview return 200/201 with the cookie alone (no Bearer header). |
| Token in localStorage | ⚠️ **residual, deliberate** | The bearer token is still mirrored to localStorage because the socket.io mini-service (port 3003) authenticates its handshake with a query-parameter token. Removing it requires a short-lived ticket flow for the socket handshake (future work). XSS reading localStorage can therefore impersonate the user until token expiry; the cookie path itself is not JS-readable. |

## 2. Authorization (BOLA / IDOR)

Every route that addresses a user by id now goes through `requireSelf(req, requestedId)`
(`lib/server/jwt.ts`): authenticated caller required (401), and an explicit
userId (query / URL param / body) may only ever equal the caller's own id (403).

Routes hardened **this session** (previously accepted unauthenticated
`?userId=`/`localuser` fallbacks — the port had regressed the upstream fixes):

- `/api/analytics/[userId]` (had **no auth at all**)
- `/api/intelligence/overview`, `/api/ml/status`, `/api/study/status`,
  `/api/study/outcomes`, `/api/study/export` (query-param fallback removed)
- `/api/dose-events` (GET+POST), `/api/dose-events/snooze`, `/api/dose-events/skip`
- `/api/medicine/today|status|add|bulk` (body `localuser` fallback removed)
- `/api/notification/today`, `/api/notification/regular-notify`
- `/api/report` (POST), `/api/report/analyze`, `/api/report/chat`,
  `/api/report/[id]/translate/[language]`, `/api/report/[id]/readability`
  (report rows additionally checked for `report.userId === caller`)
- `/api/agents/*` (medical, medicine, emergency, personal-health, reports,
  chat) — agent answers as the AUTHENTICATED caller; body identity is
  overridden server-side (memory + Conversation logs key to the verified id)
- `/api/streak`, `/api/languages/user`, `/api/preferences/timezone`
- Operator-shaped endpoints (`/api/ml/train`, `/api/reminder-engine/tick`,
  `/api/study/assign`) require authentication; see §5 for the role-check gap.

Live-verified: no-token → 401; valid token + foreign userId → 403; own id → 200.

## 3. Input validation & uploads

| Area | Status | Notes |
|---|---|---|
| Report upload | ✅ **added this session** | 10 MB max (413), PDF/plain-text only (415); was fully unvalidated in the port |
| JSON bodies | ✅ | `readJson` tolerates malformed bodies; enums validated on every route (status, arm, skip reasons, minutes 1–120) |
| SQL injection | ✅ (N/A) | Prisma parameterizes all queries; no raw SQL in app code |
| Prompt injection | ⚠️ partial | Report text is passed inside a delimited prompt; not adversarially tested (inherited honest gap from the plan) |

## 4. Secrets & logging

- `JWT_SECRET` from env with a sandbox default (documented deviation — a
  production deployment must set it; no default in prod).
- GROQ_API_KEY / GOOGLE_API_KEY: present in `.env` (owner re-supplied
  2026-10-09; `healthz` reports both tiers enabled). The preview sandbox's
  egress region (Hong Kong) is blocked by both vendors (Groq 403, Gemini
  "location not supported") — the chain degrades transparently to the
  z-ai gateway, provider-honestly labeled (see `zai-fallback.ts`); the
  Groq/Gemini tiers activate automatically from a supported network.
- No tokens, passwords, OTPs or medical content are logged (verified by
  reviewing the routes touched this session; the OTP code IS logged in the
  sandbox signup flow by design — `demoOtp` is returned to the client because
  there is no SMTP; documented in the route header).

## 5. Known, documented gaps (honest list)

1. **No role model.** Any authenticated user can trigger global operations
   (`/api/ml/train`, `/api/reminder-engine/tick` with `all:true`,
   `/api/study/assign` for themselves, `/api/study/export?all=1`). These are
   idempotent/read-only researcher conveniences; a real multi-operator
   deployment needs an operator role.
2. **Socket handshake uses a bearer token in the query string** (see §1) —
   URLs can leak into proxy logs. Ticket-based handshake is future work.
3. **User-enumeration vectors remain** (inherited from the original, kept for
   UX): signup returns "User already exists"; login distinguishes
   "Please verify your account first" and "This account was created with
   Google". Mitigations would trade UX; documented rather than silently
   changed.
4. **googleTokens column** exists in the schema but is **never written** in
   this build (OAuth routes are credential-gated stubs returning 503/400).
   If OAuth is ever activated, add AES-256-GCM encryption at rest before
   storing tokens (the plan's Phase 12 finding does not apply yet, by
   construction).
5. **Rate limiting** (UPDATED 2026-10-01): auth routes (login/signup/verify-otp/resend-otp) ARE rate-limited with sliding windows (429 + Retry-After) since the 2026-09-29 Master Audit; report uploads are per-user limited (10/10min); agent feedback 30/10min. NOT yet covered: remaining API routes and the vision endpoint (the
   upstream had express-rate-limit). The OTP route has its own attempt cap.
   Behind the sandbox gateway; add before any public deployment.
6. **CORS**: single-origin (same-origin through the gateway); the upstream's
   configurable `CLIENT_ORIGINS` is not needed here.

## 6. What changed vs. the upstream audit (regression watch)

The plan's §12 table was written against the MERN repo. Re-auditing THIS
codebase found the port had silently re-introduced: `Math.random` OTP and
backup codes, unvalidated report uploads, unauthenticated userId fallbacks on
nearly every data route, and no HttpOnly cookie. All are fixed in this
session; this file is the new baseline to diff against.
