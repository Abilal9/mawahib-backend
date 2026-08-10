# Architecture notes

## Request path

1. React Native calls `GET/POST /api/v1/...` with `Authorization: Bearer <supabase_access_token>`.
2. Nest controllers validate DTOs (`ValidationPipe`) and delegate to services.
3. Services enforce business rules and call repository interfaces.
4. Prisma repositories talk to PostgreSQL via `DATABASE_URL`.
5. `SupabaseService` is reserved for Auth admin / Storage — **not** domain tables. The mobile app never performs domain CRUD via `supabase.from(...)`.

```text
React Native
    → NestJS (/api/v1)
    → Services
    → Repository interfaces
    → Prisma
    → PostgreSQL (Supabase-hosted)
```

## Auth + session restoration

### Client

1. App starts → native/expo splash.
2. Supabase Auth restores the persisted session (`expo-sqlite` `localStorage` adapter; `persistSession` + `autoRefreshToken` enabled).
3. While `authLoading` is true, splash waits (no Welcome/Main flash).
4. If a session exists → `GET /api/v1/users/me`.
5. If the Nest user is missing (`404`) → `POST /api/v1/auth/bootstrap` once (idempotent).
6. Profile context hydrates from the Nest user. `isSignedIn` is true only when both the Supabase session and Nest user exist.
7. Navigate into Main tabs (restored) or onboarding/auth (signed out).

Logout clears the Supabase session and local authenticated state. It does **not** re-seed mock identity.

### Nest JWT verification

- Prefer **JWKS** (`SUPABASE_JWT_JWKS_URL`, or derived from `SUPABASE_URL` → `/auth/v1/.well-known/jwks.json`) with `ES256` / `RS256`.
- Fall back to `SUPABASE_JWT_SECRET` (HS256) only when JWKS is unavailable.
- Audience: `authenticated`. Issuer: `{SUPABASE_URL}/auth/v1`.
- Guards: `JwtAuthGuard` + `@CurrentUser()` on protected routes (`/auth/bootstrap`, `/users/me`).

There are no Nest login/signup endpoints — Supabase Auth owns credentials; Nest owns the application user/profile.

## Data API / RLS posture

Domain tables (`users`, `profiles`, `user_skills`) and `_prisma_migrations` are locked down for PostgREST:

- `REVOKE` from `anon` / `authenticated`
- RLS enabled with **no** permissive client policies

Prisma’s DB role bypasses RLS (do not `FORCE ROW LEVEL SECURITY` on these tables). This keeps Nest as the only domain write path.

See migration `prisma/migrations/20260810210000_phase1_security_lockdown/`.

## Replaceability

Swap Postgres host by changing `DATABASE_URL`. Swap Auth/Storage by replacing `infrastructure/supabase` without rewriting domain services.
