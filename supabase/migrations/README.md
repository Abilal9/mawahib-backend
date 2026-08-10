# Supabase SQL migrations

SQL migrations for Supabase-managed features (Auth hooks, Storage policies, RLS)
will live in this directory later.

**Domain data schema** is owned by Prisma (`prisma/schema.prisma` + `prisma migrate`).
Prefer Prisma migrations for application tables so Nest remains the source of truth
for domain models. Use this folder for Supabase-specific SQL that Prisma does not own.
