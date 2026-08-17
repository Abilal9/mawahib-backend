# Docker — Mawahib Backend

Production container image for the NestJS API (`mawahib-backend`).

## Why Docker

- Reproducible builds for local verification, Railway, and later AWS ECS/Fargate or Kubernetes
- Same Node + Prisma Linux runtime everywhere (avoids host OS drift)
- Application architecture unchanged: Nest + Prisma + remote Supabase Postgres/Auth/Storage

Docker Compose is **not** used. Postgres lives on Supabase; there is no need to run a local DB container for this service.

## Image layout

Multi-stage `Dockerfile`:

1. **builder** (`node:22-bookworm-slim`) — `npm ci`, `prisma generate`, `npm run build`
2. **runner** — production `npm ci --omit=dev`, copy `dist/`, Prisma client/engines, and Prisma CLI (for release migrations)

Node **22** is required in the image because `@supabase/supabase-js` needs native WebSocket support (Node 22+). `package.json` engines still allow `>=20` for local tooling.

Runtime command:

```text
node dist/main
```

(same as `npm run start:prod`)

The process listens on `process.env.PORT` (default `3000`). Nest’s `app.listen(port)` binds all interfaces, which is correct inside a container.

## Build

From the backend repo root:

```bash
docker build -t mawahib-backend .
```

## Run locally

Use your gitignored `.env` (never copy it into the image):

```bash
docker run --rm --env-file .env -e NODE_ENV=production -p 3000:3000 mawahib-backend
```

Health:

```bash
curl http://localhost:3000/api/v1/health
# expect: status ok, database connected, supabase configured
```

If `.env` sets `PORT` to something other than `3000`, map that port instead, e.g. `-p 8080:8080`.

## Environment variables

Runtime-only (Railway Variables or `--env-file`). Required for non-test boot — see `.env.example`:

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | Use `production` in containers |
| `PORT` | Injected by Railway; local default `3000` |
| `DATABASE_URL` | Supabase Postgres URI (Session/Direct preferred) |
| `SUPABASE_PROJECT_ID` | Project ref |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | Server-only |
| `SUPABASE_JWT_JWKS_URL` | Optional if derived from `SUPABASE_URL` |
| `SUPABASE_JWT_SECRET` | Fallback only |
| `CORS_ORIGINS` | Comma-separated browser origins |

Do **not** set `ALLOW_DEV_SEED` / `DEV_SEED_PASSWORD` in production.

## Prisma migrations

- **Build image:** `prisma generate` only (no migrate)
- **Deploy / release:** `npx prisma migrate deploy` once per release
- **Never:** `prisma migrate dev` in containers
- **Never:** migrate on every replica start as the primary strategy

## Railway (current Nixpacks vs future Docker)

The live Railway service can stay on **Railpack/Nixpacks** until you deliberately switch.

When you **choose** to switch this service to Docker:

1. Ensure the repo root `Dockerfile` is on the branch Railway deploys.
2. **Settings → Build**
   - Builder: Dockerfile (Railway auto-detects a root `Dockerfile`; confirm it is selected).
   - Clear/remove custom **Build Command** (the Dockerfile owns install/build).
3. **Settings → Deploy**
   - Clear/remove custom **Start Command** (image `CMD` is `node dist/main`).
   - Keep **Pre-Deploy Command:** `npx prisma migrate deploy`  
     (Prisma CLI is included in the image for this purpose.)
   - Keep **Health Check Path:** `/api/v1/health`
4. Leave **Variables** unchanged — Railway still injects them into the container.
5. Redeploy and confirm health + a smoke login/`/users/me`.

Until you flip the builder, pushing the Dockerfile does **not** by itself change a Nixpacks-based service (verify in the Railway UI that the builder is still Nixpacks/Railpack).

## Future ECS / Kubernetes

- Build/push the same image to ECR (or another registry).
- Set the same env vars as secrets/config.
- Run a one-shot Job/init for `npx prisma migrate deploy` (or CD step) before rolling out new tasks/pods.
- Probe `GET /api/v1/health`.
- Do not embed `.env` in the image.

## Security notes

- `.dockerignore` excludes `.env`, `node_modules`, tests, docs, etc.
- Process runs as non-root user `nestjs` (uid 1001).
- Debian slim (not Alpine) for reliable Prisma engine support.
