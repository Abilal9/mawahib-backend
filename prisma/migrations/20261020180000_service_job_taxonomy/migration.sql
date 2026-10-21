-- Phase C: canonical category and skill links for services and jobs.
-- Legacy service category text, job explore_tag, and job skills[] stay.
-- No taxonomy catalog changes and no profile skill changes.

ALTER TABLE "service_offerings" ADD COLUMN "category_id" UUID;
ALTER TABLE "job_listings" ADD COLUMN "category_id" UUID;

CREATE INDEX "service_offerings_category_id_idx" ON "service_offerings"("category_id");
CREATE INDEX "job_listings_category_id_idx" ON "job_listings"("category_id");

CREATE TABLE "service_skills" (
    "offering_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_skills_pkey" PRIMARY KEY ("offering_id","skill_id")
);

CREATE TABLE "job_skills" (
    "listing_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_skills_pkey" PRIMARY KEY ("listing_id","skill_id")
);

CREATE INDEX "service_skills_skill_id_idx" ON "service_skills"("skill_id");
CREATE INDEX "service_skills_offering_id_position_idx" ON "service_skills"("offering_id", "position");
CREATE INDEX "job_skills_skill_id_idx" ON "job_skills"("skill_id");
CREATE INDEX "job_skills_listing_id_position_idx" ON "job_skills"("listing_id", "position");

ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_skills" ADD CONSTRAINT "service_skills_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "service_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_skills" ADD CONSTRAINT "service_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE ALL ON TABLE public.service_skills FROM anon, authenticated;
REVOKE ALL ON TABLE public.job_skills FROM anon, authenticated;

ALTER TABLE public.service_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_skills ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.service_skills IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.job_skills IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
