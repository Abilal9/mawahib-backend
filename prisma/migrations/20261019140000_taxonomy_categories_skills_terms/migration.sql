-- Explore V2 Phase A: canonical taxonomy reference data.
-- Categories, skills, and skill terms only.
-- No user, service, or job links.

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_terms" (
    "id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "normalized_term" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_is_active_sort_order_idx" ON "categories"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");

-- CreateIndex
CREATE INDEX "skills_category_id_sort_order_idx" ON "skills"("category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "skill_terms_normalized_term_key" ON "skill_terms"("normalized_term");

-- CreateIndex
CREATE INDEX "skill_terms_skill_id_idx" ON "skill_terms"("skill_id");

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_terms" ADD CONSTRAINT "skill_terms_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same posture as the phase 1 lockdown: RLS on, no policies, no client grants.
-- Nest/Prisma uses the table owner, which bypasses RLS. Do not FORCE RLS.

REVOKE ALL ON TABLE public.categories FROM anon, authenticated;
REVOKE ALL ON TABLE public.skills FROM anon, authenticated;
REVOKE ALL ON TABLE public.skill_terms FROM anon, authenticated;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_terms ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.categories IS
  'Reference table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.skills IS
  'Reference table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.skill_terms IS
  'Reference table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
