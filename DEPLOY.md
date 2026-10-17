# Deploying MedSync-AI on Render — environment variables

> Never commit real keys. `.env*` is git-ignored (except `.env.example`).
> Real values live only in your local `.env` and in the host's dashboard.

## Variables

| Name | Required | Notes |
|------|----------|-------|
| `DATABASE_URL` | yes | SQLite, e.g. `file:/var/data/custom.db` (see "Database" below) |
| `JWT_SECRET` | yes | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. The socket service must use the **same** value |
| `GROQ_API_KEY` | optional | From console.groq.com/keys |
| `GOOGLE_API_KEY` | optional | From Google AI Studio |
| `GROQ_CHAT_MODEL`, `GEMINI_MODEL`, `*_PRIMARY` | optional | Overrides, see `.env.example` |

## Steps (Render Dashboard)

1. Push the repo to GitHub (without any `.env`).
2. Render Dashboard → **New +** → **Web Service** → connect the GitHub repo.
3. Settings:
   - **Runtime:** Node (or Bun if available)
   - **Build Command:** `bun install && bunx prisma generate && bun run build`
     (or `npm install && npx prisma generate && npm run build`)
   - **Start Command:** `bun run start` (or `npm run start`)
4. Open the service → **Environment** tab → **Add Environment Variable**.
   Add each variable from the table above (key + value), then **Save Changes**.
   Render redeploys automatically.
5. Tip: for several services sharing values (e.g. `JWT_SECRET`), use
   **Environment Groups** (Dashboard → Env Groups) and link the group to each service.
6. Open the service URL and check `/api/healthz` — it reports which providers are configured.

## Database (SQLite)

Render's filesystem is ephemeral: a SQLite file is lost on every deploy.
To keep data:
1. Service → **Disks** → **Add Disk**, mount path `/var/data` (paid plans).
2. Set `DATABASE_URL=file:/var/data/custom.db`.
3. Add `bunx prisma db push` to the Build/Pre-deploy command to create tables.

For production with real patient data, prefer Render Postgres (change the Prisma provider).

## Socket service (`mini-services/socket-service`)

Deploy as a second **Web Service** (Root Directory `mini-services/socket-service`,
Start Command `bun run index.ts`) with the same `JWT_SECRET`.
Note: it currently uses fixed ports 3003/3004 — change to `process.env.PORT` for Render.

## Rotating a leaked key

1. Create the new key at the provider, 2. update it in Render → Environment,
3. revoke the old key. Never reuse a key that was ever committed.
