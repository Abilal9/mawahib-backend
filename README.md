# Mawahib Backend

NestJS REST API for the Mawahib talent marketplace. React Native talks to this API; Nest owns business logic; Supabase/PostgreSQL is replaceable infrastructure.

```
React Native → NestJS REST → Service → Repository Interface → Prisma (PostgreSQL)
                                                              ↑
                                         Supabase Auth JWT / Storage (infra only)
```

## Why NestJS

- Clear module boundaries that map to the frontend’s existing repository/service split
- Controllers stay thin; services own rules; repositories hide persistence
- First-class TypeScript, testing, validation, and guards for Supabase JWT
- Avoids putting domain logic in Supabase Edge Functions or client-side mocks

## Database strategy: Prisma + direct Postgres

**Chosen:** [Prisma](https://www.prisma.io/) with a direct `DATABASE_URL` to Supabase’s PostgreSQL.

| Layer | Tool | Role |
| --- | --- | --- |
| Domain data | Prisma → PostgreSQL | Schema, migrations, typed queries |
| Auth / Storage | `@supabase/supabase-js` (infra) | JWT verification, Storage, Auth admin |

**Do not** call `supabase.from(...)` from controllers or domain services. Put persistence behind repository interfaces implemented with Prisma.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Canonical product docs

| Document | Role |
| --- | --- |
| [`docs/COMMERCIAL_MODEL.md`](docs/COMMERCIAL_MODEL.md) | **Canonical** money, currency, country, snapshots, totals |
| [`docs/MARKETPLACE_CANONICAL_FLOW.md`](docs/MARKETPLACE_CANONICAL_FLOW.md) | **Canonical** marketplace UX terminology & workflow |
| [`docs/MARKETPLACE_WORK_REQUESTS.md`](docs/MARKETPLACE_WORK_REQUESTS.md) | Work request / engagement API & state machine |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Request path, auth, media, current module status |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Current implementation status & next focus |

Older encyclopedias (`BACKEND_BLUEPRINT.md`, `MVP_MASTER_BLUEPRINT.md`) are historical design references. Prefer the docs above when they conflict.

## Implementation status

### Shipped (use in production-like testing)

| Area | Notes |
| --- | --- |
| Auth / users / profiles | JWKS JWT, `POST /auth/bootstrap`, `GET\|PATCH /users/me` |
| Media | Nest upload-sessions → Supabase Storage → complete |
| Portfolio / services | Owner CRUD + visitor reads |
| Marketplace | Listings, applications, work requests, engagements, explore |
| Messaging | Conversations, messages, media attachments, unread |
| Connections | Requests, accept/reject, connection graph |
| Notifications | List, unread, mark read, deep-link payloads |
| Commercial / money | Snapshots, SA→SAR / AE→AED, `termsTotal` / `chargeableTotal` — see `COMMERCIAL_MODEL.md` |

### Not started / deferred

| Area | Notes |
| --- | --- |
| Posts / Home Feed | No Nest module yet (FE still mock) |
| Stories | Deferred |
| Payments / Escrow | Not implemented; commercial inputs are frozen |
| Full reviews product | Engagement review bridge exists for messaging archive; product UI incomplete |
| Admin panel | Deferred |
| Request attachments | Placeholder in marketplace UX |

## Project layout

```
src/
  main.ts                 # api/v1 prefix, ValidationPipe, CORS, exception filter
  app.module.ts
  config/                 # Zod-validated env via @nestjs/config
  common/                 # filters, guards, decorators
  infrastructure/
    database/             # Prisma module/service
    supabase/             # secret-key client factory (Auth/Storage infra)
  modules/
    health/
    auth/
    users/
    media/
    portfolio/
    services/
    marketplace/
    explore/
    messaging/
    connections/
    notifications/
prisma/schema.prisma      # Domain models (users → marketplace → messaging)
docs/                     # Architecture, marketplace, commercial, ops
```

## Prerequisites

- Node.js 20+ (**22 LTS recommended**)
- npm 10+
- Supabase project with `DATABASE_URL` and Auth/Storage credentials

## Local setup

```bash
cp .env.example .env
# fill SUPABASE_* and DATABASE_URL

npm install
npx prisma generate
npm run start:dev
```

Health check:

```bash
curl http://localhost:3000/api/v1/health
# { "status": "ok", "database": "connected", "supabase": "configured", ... }
```

Frontend against this API: in `mawahib-ui-prototype`, run `npm run start:local` (see UI `docs/API_ENV.md`).

Dev seed (optional): [`docs/DEV_SEED.md`](docs/DEV_SEED.md).

## Docker / Railway

Production image and Railway notes: [`docs/DOCKER.md`](docs/DOCKER.md).

```bash
docker build -t mawahib-backend .
docker run --rm --env-file .env -e NODE_ENV=production -p 3000:3000 mawahib-backend
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run start:dev` | Watch mode (local development) |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run compiled app |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Create/apply Prisma migrations |
| `npm run seed:dev` | Dev seed (requires `ALLOW_DEV_SEED=true`) |

## Environment variables

Copy from `.env.example`. Never commit `.env`.

| Variable | Required (non-test)? | Purpose |
| --- | --- | --- |
| `NODE_ENV` | No (default `development`) | Runtime mode |
| `PORT` | No (default `3000`) | HTTP port |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `SUPABASE_PROJECT_ID` | Yes | Supabase project ref |
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | No for Nest server | Publishable/anon key (frontend) |
| `SUPABASE_SECRET_KEY` | Yes | **Server-only** secret/service key |
| `DATABASE_URL` | Yes | Prisma → Supabase Postgres URI |
| `SUPABASE_JWT_SECRET` | No | HS256 fallback when JWKS unavailable |
| `SUPABASE_JWT_JWKS_URL` | No | JWKS URL (else derived from `SUPABASE_URL`) |

Startup logs only print `configured` / `missing` for these keys — never values.

## Next work (summary)

See [`docs/ROADMAP.md`](docs/ROADMAP.md). Near-term product focus: **Home Feed / Posts**, profile completion, reviews, job editing, request attachments, explore/settings polish, then stabilization before Escrow/Payments and admin.

## License

UNLICENSED — private Mawahib prototype.
