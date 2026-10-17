# MedSync-AI deployment (Supabase + Render)

This deployment configuration lives on the review branch `deploy/postgres-preflight`. The `main` branch is left unchanged until the PostgreSQL migration and CI checks are reviewed.

## Architecture

- **Web app / API:** Next.js on Render.
- **Database:** a dedicated Supabase PostgreSQL project named `medsync-ai`.
- **Live notifications:** a second Render Web Service running Socket.IO. The browser uses `/socket.io/`; signed server notifications use the same service's `/emit` HTTP endpoint.
- **Shared secret:** Render generates one `JWT_SECRET` in the `medsync-ai-shared-secrets` environment group for both services.

Do not point MedSync-AI at the existing `masar-startup` Supabase project.

## 1. Prepare Supabase

1. Create a separate Supabase project named `medsync-ai` in `eu-central-1`.
2. In the new project's **Connect** dialog, select the **Session pooler** connection string using port `5432`. Use it for both `DATABASE_URL` and `DIRECT_URL` on Render. This avoids depending on the direct database connection being reachable from an IPv4-only host.
3. Keep the database password in the provider's secret manager / Render environment, never in GitHub, `.env.example`, or chat messages.

The schema has been converted from SQLite to PostgreSQL, with compatibility fields retained for legacy UI routes while the authenticated routes continue to use the current field names.

## 2. Deploy the Render Blueprint

1. Open Render's **New + → Blueprint** flow and select this repository, branch `deploy/postgres-preflight`, and `render.yaml`.
2. Before applying, set the requested `DATABASE_URL` and `DIRECT_URL` values to the Supabase Session pooler string. Add `GROQ_API_KEY` and/or `GOOGLE_API_KEY` only if you have them.
3. Review the two Web Services: `medsync-ai` and `medsync-socket`. The Blueprint marks both as free-plan resources; check Render's current dashboard for any usage or plan changes before applying.
4. The first web-service build runs `prisma generate`, a non-destructive `prisma db push`, then the Next.js build. The push is intended for the new, empty Supabase database. Do not use `--accept-data-loss`.
5. After both services are live, open `https://<medsync-ai-service>/api/healthz` and `https://<medsync-socket-service>/health`. The web app's `/api/readyz` should also report the database and dose-event tables as ready.

## 3. Secrets and CORS

- Never set `JWT_SECRET` to a fixed or sample value. Render's environment group generates one shared value.
- The initial Blueprint leaves `SOCKET_CORS_ORIGINS=*` so the first service URLs can be discovered. After the web app is live, change this shared environment variable to the exact public HTTPS origin of the web app (no trailing slash), then redeploy the Socket.IO service.
- Configure OAuth and AI-provider credentials separately if the corresponding features are required. Do not paste live secrets into public GitHub files.

## 4. Build and smoke tests

The GitHub Actions workflow `.github/workflows/deploy-preflight.yml` validates the Prisma schema, generates the Prisma Client, type-checks and builds the Next.js app, and smoke-tests the Socket.IO health endpoint plus the HMAC-protected `/emit` route.

## Important limitations

- This is a deployment preflight branch, not a claim that the application is medically validated or ready for real patient data.
- The demo seed endpoint and several legacy unscoped endpoints are disabled in production to prevent accidental data deletion or cross-user access.
- The project currently uses `prisma db push` to bootstrap the new database. Before making breaking schema changes or treating this as a long-lived production system, introduce reviewed, versioned Prisma migrations and test them against a non-production database.
- Review the TypeScript/build checks and run functional tests for sign-up/login, medication CRUD, dose updates, report saving, Socket.IO authentication, and notification delivery before merging this branch into `main`.
