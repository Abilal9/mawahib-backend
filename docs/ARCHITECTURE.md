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

## Auth redirects (mobile)

Signup confirmation uses **email OTP** (6-digit code) to match `ConfirmCodeScreen`.

Deep link scheme: `mawahib://auth/callback` (allow-list in Supabase Redirect URLs).
Do not use the Nest API origin (`http://localhost:3000`) as Site URL / confirmation redirect.

See `mawahib-ui-prototype/docs/AUTH.md` for dashboard steps.


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

Signup collects **email + phone (E.164)** once. Profile stores `phone_e164`, `email_verified`, and `phone_verified` independently. Email verification is required to enter the app; phone OTP activates when Supabase SMS is configured (no architecture change). See UI `docs/AUTH.md`.

## Phase 2 — Portfolio, Services, Media

Domain tables: `media_assets`, `portfolio_projects`, `portfolio_media`, `service_offerings`, `service_packages`, `service_addons`, `service_media`.

Upload flow (Nest-issued signed URLs only):

1. `POST /media/upload-sessions`
2. Client PUTs bytes to Storage
3. `POST /media/:id/complete` (Nest verifies object, marks `ready`)

Own CRUD: `/users/me/portfolio`, `/users/me/services` (+ order endpoints).  
Visitor reads: `GET /users/:userId/portfolio`, `GET /users/:userId/services`.

Storage buckets: `avatars` (public read), `portfolio` / `services` (private + signed read).



Domain tables (`users`, `profiles`, `user_skills`) and `_prisma_migrations` are locked down for PostgREST:

- `REVOKE` from `anon` / `authenticated`
- RLS enabled with **no** permissive client policies

Prisma’s DB role bypasses RLS (do not `FORCE ROW LEVEL SECURITY` on these tables). This keeps Nest as the only domain write path.

See migration `prisma/migrations/20260810210000_phase1_security_lockdown/`.

## Replaceability

Swap Postgres host by changing `DATABASE_URL`. Swap Auth/Storage by replacing `infrastructure/supabase` without rewriting domain services.
