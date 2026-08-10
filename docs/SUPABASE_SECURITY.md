# Supabase security (Phase 1)

## Architecture decision

Mawahib domain data is accessed only through NestJS + Prisma.

| Layer | Role |
| --- | --- |
| React Native | Supabase Auth (session) + Nest HTTP API |
| NestJS | JWT verify (JWKS), business rules, repositories |
| Prisma | SQL against PostgreSQL |
| Supabase Data API | **Not used for domain CRUD** |

Therefore we do **not** create client-facing RLS policies that would encourage `supabase.from('users')` bypasses.

## Applied controls (reproducible)

Migration: `prisma/migrations/20260810210000_phase1_security_lockdown/migration.sql`

- Enable RLS on `users`, `profiles`, `user_skills`, `_prisma_migrations`
- Zero permissive policies (deny for non-bypass roles)
- `REVOKE ALL` from `anon` / `authenticated` on domain tables
- Revoke public/PostgREST access to `_prisma_migrations`

Apply with:

```bash
npx prisma migrate deploy
```

## Dashboard settings (manual)

These are Auth project settings, not SQL migrations:

1. **Leaked password protection** — enable under Authentication → Providers / Security (HaveIBeenPwned check). Recommended for all environments that accept real passwords.
2. Unused index advisories — ignore unless an index is confirmed unused in production metrics; do not drop during Phase 1.

## Accepted advisories

| Finding | Decision |
| --- | --- |
| `citext` in `public` | Accepted for Phase 1; required by Prisma `@db.Citext` columns. Moving the extension is a later ops task. |
| Unused indexes | Ignore until real query volume exists. |

## What not to do

- Do not add `SELECT/INSERT/UPDATE/DELETE` policies for `authenticated` on domain tables.
- Do not expose `_prisma_migrations` via grants or permissive RLS.
- Do not disable Nest and talk to Postgres from the mobile client.
