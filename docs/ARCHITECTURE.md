# Architecture notes

## Request path

1. React Native calls `GET/POST /api/v1/...` with optional `Authorization: Bearer <supabase_access_token>`.
2. Nest controllers validate DTOs (`ValidationPipe`) and delegate to services.
3. Services enforce business rules and call repository interfaces (added per feature).
4. Prisma repositories talk to PostgreSQL via `DATABASE_URL`.
5. `SupabaseService` is reserved for Auth admin / Storage — not domain tables.

## Auth foundation

- Clients sign in with **Supabase Auth**.
- Nest `JwtStrategy` verifies the access token (JWKS preferred, or `SUPABASE_JWT_SECRET`).
- `JwtAuthGuard` + `@CurrentUser()` are stubs ready for protected routes.
- No Nest login/signup endpoints in this foundation.

## Replaceability

Swap Postgres host by changing `DATABASE_URL`. Swap Auth/Storage by replacing `infrastructure/supabase` without rewriting domain services.
