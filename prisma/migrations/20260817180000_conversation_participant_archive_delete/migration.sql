-- Phase 4 extensions: per-participant archive/soft-delete + minimal engagement reviews.
-- NestJS (service role) owns these tables; PostgREST stays locked down.

-- AlterTable conversation_participants
ALTER TABLE "conversation_participants" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "conversation_participants" ADD COLUMN "deleted_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "conversation_participants_user_id_idx";
CREATE INDEX "conversation_participants_user_id_deleted_at_archived_at_idx"
  ON "conversation_participants"("user_id", "deleted_at", "archived_at");

-- CreateTable engagement_reviews
CREATE TABLE "engagement_reviews" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engagement_reviews_engagement_id_reviewer_id_key"
  ON "engagement_reviews"("engagement_id", "reviewer_id");
CREATE INDEX "engagement_reviews_reviewer_id_idx" ON "engagement_reviews"("reviewer_id");
CREATE INDEX "engagement_reviews_engagement_id_idx" ON "engagement_reviews"("engagement_id");

ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- PostgREST lockdown
REVOKE ALL ON TABLE public.engagement_reviews FROM anon, authenticated;
ALTER TABLE public.engagement_reviews ENABLE ROW LEVEL SECURITY;
