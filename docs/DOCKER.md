# Docker — Mawahib Backend

Production container image for the NestJS API (`mawahib-backend`).

## Why Docker

- Reproducible builds for local verification, Railway, and later AWS ECS/Fargate or Kubernetes
- Same Node + Prisma Linux runtime everywhere (avoids host OS drift)
- Application architecture unchanged: Nest + Prisma + remote Supabase Postgres/Auth/Storage

Docker Compose is **not** used. Postgres lives on Supabase; there is no need to run a local DB container for this service.

## Image layout

Multi-stage `Dockerfile`:

1. **builder** (`node:22.23.4-bookworm-slim`) — `npm ci`, `prisma generate`, `npm run build`
2. **runner** (`node:22.23.4-bookworm-slim`) — production `npm ci --omit=dev`, copy `dist/`, Prisma client/engines, and Prisma CLI (for a later, separately authorized migration)

Both stages pin Node 22.23.4. `@supabase/supabase-js` needs native WebSocket support (Node 22+). `package.json` engines still allow `>=20` for local tooling.

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
- **Current Railway service:** no pre-deploy command is configured. Do not add `npx prisma migrate deploy` as an automatic pre-deploy step. Committing a migration file does not apply it.
- Apply a migration only as a deliberate operation against a verified database target.
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
- One successful startup healthcheck was observed. A deliberately failing deployment healthcheck has not been exercised.
- An application rollback-and-return exercise was completed. That historical evidence does not make older images, or snapshots that still contain obsolete credentials, safe recovery choices.
- The patched recovery reference is deployment `d720ace3-5883-4bb2-bac9-d4e9335e82ea`, built from `97b71efccacdaee8880592aec38b257a49004bea`, using the current credentials. Recover by deploying that source with the current variables. Do not roll back to an earlier image.

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
