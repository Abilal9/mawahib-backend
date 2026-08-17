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
- First-class TypeScript, testing, validation, and guards for Supabase JWT later
- Avoids putting domain logic in Supabase Edge Functions or client-side mocks forever

## Database strategy: Prisma + direct Postgres

**Chosen:** [Prisma](https://www.prisma.io/) with a direct `DATABASE_URL` to Supabase’s PostgreSQL.

| Layer | Tool | Role |
| --- | --- | --- |
| Domain data | Prisma → PostgreSQL | Schema, migrations, typed queries |
| Auth / Storage | `@supabase/supabase-js` (infra) | JWT verification helpers, Storage, Auth admin later |

**Why not `supabase.from()` as the primary DB layer**

1. Nest owns business logic; PostgREST-style calls in services couple the app to Supabase’s API shape.
2. Prisma keeps the domain schema in-repo and makes swapping Postgres hosts (or leaving Supabase later) a connection-string change.
3. `@supabase/supabase-js` remains for Auth JWTs and Storage — not application tables.

**Do not** call `supabase.from(...)` from controllers or domain services. Put persistence behind repository interfaces implemented with Prisma.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Planned modules (from frontend domains)

Aligned with `mawahib-ui-prototype` `src/data/types/` and `src/repositories/types.ts` — **not implemented yet**:

| Module | Frontend entities / repositories |
| --- | --- |
| `users` / `profiles` | `User`, `ProfileContent`, `ProfileRepository`, `UserRepository` |
| `posts` | `Post`, `Comment`, `Story`, `PostRepository` |
| `jobs` | `JobListing`, `UserJob`, `JobListingRepository`, `UserJobRepository` |
| `catalog` | `CatalogService`, `Talent`, `CatalogRepository` |
| `messages` | `Conversation`, `Message`, `MessageRepository` |
| `notifications` | `Notification`, `NotificationRepository` |
| `reviews` | `Review`, `ReviewsBundle`, `ReviewRepository` |
| `connections` | `ConnectionRelation`, `ConnectionRepository` |
| `auth` | Supabase JWT verification (foundation stub present) |

Phase 1 implemented: JWKS JWT auth, `POST /auth/bootstrap`, `GET|PATCH /users/me`, Prisma `users`/`profiles`/`user_skills`.

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
    health/               # GET /api/v1/health
    auth/                 # JwtStrategy stub (no login endpoints)
prisma/schema.prisma      # minimal — no domain models yet
supabase/migrations/      # Supabase-specific SQL later (RLS, Storage, etc.)
docs/ARCHITECTURE.md
```

## Prerequisites

- Node.js 20+ (22 LTS recommended)
- npm 10+
- Supabase project (credentials optional until you wire DB/Auth)

## Local setup

```bash
cp .env.example .env
# fill SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, and DATABASE_URL locally

npm install
npx prisma generate
npm run start:dev
```

Health check:

```bash
curl http://localhost:3000/api/v1/health
# { "status": "ok", "database": "connected", "supabase": "configured", ... }
```

`database` is `"connected"` | `"disconnected"` | `"not_configured"`.
`supabase` is `"configured"` | `"not_configured"`.

## Docker

Production image (local test / Railway Docker / future ECS): see [`docs/DOCKER.md`](docs/DOCKER.md).

```bash
docker build -t mawahib-backend .
docker run --rm --env-file .env -e NODE_ENV=production -p 3000:3000 mawahib-backend
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run start:dev` | Watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run compiled app |
| `npm run lint` | ESLint (auto-fix) |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Create/apply Prisma migrations (after models exist) |

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
| `SUPABASE_JWT_SECRET` | No | Symmetric JWT verify (Auth stub) |
| `SUPABASE_JWT_JWKS_URL` | No | Planned JWKS URL |

Startup logs only print `configured` / `missing` for these keys — never values.

## Future migration path

1. Add Prisma models incrementally (users/profiles first).
2. Implement repository interfaces + Nest modules matching frontend contracts.
3. Point the React Native app from mock repositories to this API.
4. Keep Supabase Auth on the client; Nest verifies Bearer tokens.
5. If leaving Supabase later: keep Prisma + Postgres; replace Auth/Storage adapters only.

## License

UNLICENSED — private Mawahib prototype.
