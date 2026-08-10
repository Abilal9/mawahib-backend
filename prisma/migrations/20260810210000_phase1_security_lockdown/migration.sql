-- Phase 1 security lockdown
-- Architecture: React Native → NestJS → Prisma → PostgreSQL.
-- Domain tables must not be writable (or readable) via Supabase Data API
-- (anon / authenticated roles). Nest/Prisma connects with a privileged DB role
-- that bypasses RLS; we intentionally do NOT FORCE RLS on table owners.
--
-- Strategy: enable RLS with zero permissive policies + revoke grants from
-- PostgREST roles. Do not add client-facing CRUD policies.

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_skills FROM anon, authenticated;

-- Prisma migrations table must never be exposed via Data API
REVOKE ALL ON TABLE public._prisma_migrations FROM anon, authenticated, PUBLIC;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.users IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.profiles IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.user_skills IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
