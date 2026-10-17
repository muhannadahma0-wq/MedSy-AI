# MedSync-AI — Quick Start

> Next.js 16 + Prisma (SQLite) + Socket.IO + 4 AI agents

## Requirements

- **Bun 1.3+** (recommended) or Node.js 20+
- A `.env` file in the project root (copy `.env.example` and fill in your own values)

## Steps

```bash
# 1) Create your environment file
cp .env.example .env     # then edit it; also create mini-services/socket-service/.env
                         # (see mini-services/socket-service/.env.example) with the SAME JWT_SECRET

# 2) Install dependencies
bun install

# 3) Set up the database
bun run db:generate
bun run db:push          # creates the SQLite schema
bun run scripts/seed-demo.ts   # optional: demo data

# 4) Start the app server
bun run dev              # → http://localhost:3000

# 5) (Optional — for real-time notifications) the Socket.IO service
cd mini-services/socket-service
bun install
bun run dev              # → port 3003 (Socket.IO) + 3004 (internal emit bridge)
```

## Demo account

| Field | Value |
|---|---|
| Email | `demo@medsync.ai` |
| Password | `demo1234` |

## ⚠️ Security notice

Never commit `.env` files. `.gitignore` excludes them automatically (only `.env.example` is tracked).
Secrets you need to provide yourself:
- `JWT_SECRET` — session signing secret (must be identical in `mini-services/socket-service/.env`)
- `GROQ_API_KEY` + `GOOGLE_API_KEY` — AI provider keys

For hosting (e.g. Render), see [`DEPLOY.md`](DEPLOY.md).

## Provider notes (documented transparently)

Provider chain: **Groq → Gemini → z-ai (GLM)**, per agent.
The keys work only from supported regions; from blocked networks the chain automatically falls back to z-ai
with the flag `fallbackUsed: true` — see `docs/LIMITATIONS.md`.

## Post-start readiness checks

```bash
curl http://localhost:3000/api/healthz   # {"status":"ok", ...}
bun run lint                             # 0 errors
bun run scripts/verify-data.ts           # data integrity checks
bun run scripts/test-security.ts         # security battery 23/23
```

## Quick map

| Path | Contents |
|---|---|
| `src/` | All code (UI + 62 API routes + 14 Prisma models + 4 AI agents) |
| `docs/` | Technical documentation — start with `AI_ARCHITECTURE.md` |
| `mini-services/` | The standalone Socket.IO service |
| `ml-artifacts/` | Active ML model metadata (Logistic Regression) |
