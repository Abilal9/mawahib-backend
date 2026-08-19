# Supabase SQL migrations

SQL for Supabase-managed features (Storage policies, Auth-adjacent SQL, extra RLS) lives here when Prisma does not own it.

**Domain data schema** is owned by Prisma (`prisma/schema.prisma` + `prisma migrate`). Prefer Prisma migrations for application tables so Nest remains the source of truth for domain models.

Existing example: Phase 2 Storage bucket SQL under this directory. New Nest domain tables still belong in Prisma migrations; keep PostgREST lockdown patterns aligned with [`SUPABASE_SECURITY.md`](../docs/SUPABASE_SECURITY.md).
