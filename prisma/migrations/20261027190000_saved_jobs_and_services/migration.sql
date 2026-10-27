-- Saved jobs and services. Post saves already exist.
-- Additive only: no row updates, no backfill, no table rewrite.
-- Nest/Prisma uses the table owner, which bypasses RLS. Do not FORCE RLS.

CREATE INDEX "post_saves_user_id_created_at_post_id_idx"
  ON "post_saves"("user_id", "created_at" DESC, "post_id" DESC);

DROP INDEX "post_saves_user_id_created_at_idx";

CREATE TABLE "job_saves" (
    "job_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_saves_pkey" PRIMARY KEY ("job_id","user_id")
);

CREATE TABLE "service_saves" (
    "service_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_saves_pkey" PRIMARY KEY ("service_id","user_id")
);

CREATE INDEX "job_saves_user_id_created_at_job_id_idx"
  ON "job_saves"("user_id", "created_at" DESC, "job_id" DESC);

CREATE INDEX "service_saves_user_id_created_at_service_id_idx"
  ON "service_saves"("user_id", "created_at" DESC, "service_id" DESC);

ALTER TABLE "job_saves"
  ADD CONSTRAINT "job_saves_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "job_listings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_saves"
  ADD CONSTRAINT "job_saves_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_saves"
  ADD CONSTRAINT "service_saves_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service_offerings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_saves"
  ADD CONSTRAINT "service_saves_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE public.job_saves FROM anon, authenticated;
REVOKE ALL ON TABLE public.service_saves FROM anon, authenticated;

ALTER TABLE public.job_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_saves ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.job_saves IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.service_saves IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
