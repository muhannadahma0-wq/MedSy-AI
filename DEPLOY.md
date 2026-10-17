# MedSync-AI deployment: Supabase + Render

## Current status

This setup lives on the review branch `deploy/postgres-preflight`; `main` has not been modified.

- **GitHub branch:** [deploy/postgres-preflight](https://github.com/muhannadahma0-wq/MedSy-AI/tree/deploy/postgres-preflight)
- **Supabase project:** `medsync-ai` (`wyaxwyucknjbghaqppls`), region `eu-central-1`
- **Render web app:** [medsync-ai-8wq3.onrender.com](https://medsync-ai-8wq3.onrender.com)
- **Render Socket.IO service:** [medsync-socket.onrender.com](https://medsync-socket.onrender.com)

The Supabase project is separate from the existing `masar-startup` project. Fourteen Prisma tables have been created and verified in the new database. The SQL used is committed at `supabase/migrations/20261017164917_initial_medsync_ai_schema.sql`. Row-level security is enabled on all 14 tables, and direct table privileges are revoked from Supabase's `anon` and `authenticated` API roles. The app uses server-side Prisma.

The Socket.IO service has built and gone live on Render. The Next.js service is being deployed from this branch. **Database access is not complete yet:** the Render app's `DATABASE_URL` and `DIRECT_URL` variables currently contain safe local placeholders and must be replaced with the new Supabase connection string.

## Required final step: set Supabase connection strings in Render

1. Open the [Supabase project dashboard](https://supabase.com/dashboard/project/wyaxwyucknjbghaqppls).
2. Click **Connect** and select **Session pooler**. Render's free web services are IPv4-only, so the shared session pooler is the appropriate endpoint. Copy the connection string shown there; do not compose the pooler host or username by hand.
3. Open the [Render web service environment settings](https://dashboard.render.com/web/srv-db9qebcs728c73clk840).
4. Replace both `DATABASE_URL` and `DIRECT_URL` with that copied Session Pooler connection string. Replace only the password placeholder with the database password and URL-encode special characters in the password if required. Do not paste the password into GitHub or this chat.
5. Save the environment changes and let Render redeploy the web service.
6. Once the deploy is live, test:
   - `https://medsync-ai-8wq3.onrender.com/api/healthz` — process liveness
   - `https://medsync-ai-8wq3.onrender.com/api/readyz` — database and application readiness; it should return `"status":"ready"`
   - `https://medsync-socket.onrender.com/health` — Socket.IO service health

Because the schema migration was already applied directly to the new Supabase project, the currently deployed Render build command does **not** run `prisma db push`. Keep secrets in Render's environment settings.

## Environment and safety notes

- Render created a random shared `JWT_SECRET` for the Next.js API and Socket.IO service. Do not replace it with a sample string. Rotating it later signs out existing tokens and requires updating both services together.
- Socket.IO CORS is restricted to the web app origin `https://medsync-ai-8wq3.onrender.com`.
- `GROQ_API_KEY` and `GOOGLE_API_KEY` have not been configured; features depending on these providers may need additional provider credentials.
- The deployment is a testing/staging deployment, not medically validated software. Do not enter real patient data until the app's authorization, operational monitoring, backups, and clinical validation have been reviewed.
- The GitHub CI build passed on commit `872db86271c3a2d09539e6f2d57ba1948f5a44c3`, including Prisma schema validation, Prisma Client generation, Next.js production build and Socket.IO signed-bridge smoke tests. The subsequent commit mainly changed Render configuration and migration documentation.
