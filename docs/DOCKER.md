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
curl -i http://localhost:3000/api/v1/health
# healthy: HTTP 200, status ok, database connected, supabase configured
# degraded: HTTP 503 with the same JSON fields
# supabase: configured means the client exists, not a live Supabase call
# a slow database probe returns within 2.5s; that deadline does not cancel the query
```

If `.env` sets `PORT` to something other than `3000`, map that port instead, e.g. `-p 8080:8080`.

## Environment variables

Runtime-only (Railway Variables or `--env-file`). Required for non-test boot — see `.env.example`:

| Variable                | Notes                                            |
| ----------------------- | ------------------------------------------------ |
| `NODE_ENV`              | Use `production` in containers                   |
| `PORT`                  | Injected by Railway; local default `3000`        |
| `DATABASE_URL`          | Supabase Postgres URI (Session/Direct preferred) |
| `SUPABASE_PROJECT_ID`   | Project ref                                      |
| `SUPABASE_URL`          | Project URL                                      |
| `SUPABASE_SECRET_KEY`   | Server-only                                      |
| `SUPABASE_JWT_JWKS_URL` | Optional if derived from `SUPABASE_URL`          |
| `SUPABASE_JWT_SECRET`   | Fallback only                                    |
| `CORS_ORIGINS`          | Comma-separated browser origins                  |

Do **not** set `ALLOW_DEV_SEED` / `DEV_SEED_PASSWORD` in production.

## Prisma migrations

- **Build image:** `prisma generate` only. The container command is `node dist/main` and does not migrate.
- **Current Railway service:** no pre-deploy command. Committing a migration file does not apply it.
- Apply SQL only as a deliberate, separately authorized step.
- **Never:** `prisma migrate dev` in containers.
- **Never:** migrate on every replica start.

## Railway

Production builds with the repo `Dockerfile` and starts from the image command. One replica.

Applied settings:

- GitHub autodeploy follows `main`. Wait for CI is applied, so a GitHub-triggered deployment waits until GitHub Actions on that commit succeed before the image build starts. Manual deploy, redeploy, and rollback were not checked against that gate.
- Healthcheck path is `/api/v1/health`. The timeout is the default 300 seconds.
- No pre-deploy command. Committing or pushing a migration file does not apply it.

Readiness:

- HTTP 200 with `status: ok` is healthy. HTTP 503 with `status: degraded` is not ready. The JSON fields stay the same.
- `supabase: configured` means the server client exists. It is not a live Auth or Storage call, and a healthy response does not show that every feature or provider is working.
- Each health response waits at most 2.5 seconds for the shared database probe. That deadline does not cancel the query.
- Railway calls the path while a deployment is starting. A successful check is what lets that deployment become active. It does not keep checking an already-active deployment.
- One successful healthcheck was observed. A failing healthcheck and an application rollback have not been exercised.

Do not add a pre-deploy `prisma migrate deploy` as part of ordinary image setup. The Prisma CLI is in the image for a later, separately authorized migration step. It is not wired to start.

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
