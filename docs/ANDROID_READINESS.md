# ANDROID_READINESS.md — Capacitor / Android (Phase P11)

**Owner:** Agent 1 (Lead) + Agent 2 (client) · **Status: scaffolded, execution gated** — per the plan, Android begins only after the web release candidate passes (G9 ✅ 2026-10-10) **and** on a machine with the Android SDK. This sandbox has no Android SDK/emulator, so P11-01..P11-08 are delivered as a verified-ready scaffold + exact runbook.

## What is already in place

| Piece | Status |
|---|---|
| Web release candidate | ✅ G9 passed — 350/350 checks on Express+PostgreSQL (REGRESSION_REPORT, archived — worklog.md) |
| Client production build | ✅ `migration/client` builds independently (2,351 modules; Task 28) |
| `capacitor.config.ts` | ✅ created (appId `ai.medsync.app`, appName, webDir `dist`, mixed content disabled) |
| SPA routing | ✅ BrowserRouter + Express fallback — in Capacitor the WebView serves `dist/` from the app bundle; deep links need the Capacitor App plugin (below) |
| API base | client uses relative `/api` through the Vite dev proxy in dev; **for Android builds the API base must be an absolute HTTPS URL** (see steps) |
| Socket URL | env-driven `VITE_SOCKET_URL` — must point at the production socket origin for Android |
| Camera/vision | `/api/agents/vision` accepts multipart image uploads — ready for the Capacitor Camera/filesystem plugins |
| Offline | the client's offline queue (IndexedDB) ships in the bundle unchanged |

## Owner execution steps (on an Android-SDK machine)

1. `cd migration/client && bun install`
2. Add Capacitor (versions current at execution time):
   `bun add @capacitor/core @capacitor/cli @capacitor/android`
3. Set public build env (`.env.production`): `VITE_API_URL=https://api.<your-domain>` · `VITE_SOCKET_URL=https://api.<your-domain>` (or the socket origin) · `VITE_GOOGLE_CLIENT_ID=<real id>`.
   → NOTE (the single required code touch): the API client currently uses relative `/api`; introduce `VITE_API_URL` in the central API layer (one constant) — search `fetch("/api` / `axios` base in `src/services`.
4. `bun run build` (produces `dist/`)
5. `bunx cap add android` · `bunx cap sync android`
6. Open `android/` in Android Studio; set icons/splash (P11-01); verify WebView session behavior against HTTPS (P11-02 — cookies need `SameSite=None; Secure` on the production API, or rely on the Bearer token path which is already primary).
7. Camera integration (P11-03): `@capacitor/camera` → return base64/file URI → POST to `/api/agents/vision` (existing contract).
8. Push notifications (P11-04/P11-06): Socket.IO alone is NOT a substitute when the app is closed (plan G11) — integrate **FCM** (`@capacitor/push-notifications`) + a server-side delivery path (extend `notifications.ts` bridge or add an FCM sender service; the reminder engine already centralizes delivery points).
9. Test emulator + physical device (permissions, lifecycle, offline sync restoration, report download/share via `@capacitor/filesystem` + `share`) — P11-05/P11-06.
10. `./gradlew assembleDebug` (P11-07); signed release/AAB only with real credentials + explicit approval.
11. Document signing-key custody + Android-specific limitations (P11-08).

## Known constraints to carry into Android QA

- Emergency escalation must remain visually dominant (the gateway appends escalation lines; verify rendering in the WebView).
- RTL (Arabic) layout must be re-verified in the WebView (fonts ship in the bundle — verified in web E2E).
- The vision upload size limit (route-validated) + device camera output sizes.
- Background delivery requires FCM (above); foreground realtime uses Socket.IO (already env-driven).
