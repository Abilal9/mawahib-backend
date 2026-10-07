ALTER TYPE "MediaPurpose" ADD VALUE 'review';

ALTER TABLE "work_engagements"
  ADD COLUMN "completed_at" TIMESTAMP(3);

CREATE TABLE "engagement_review_media" (
  "id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "engagement_review_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engagement_review_media_review_id_media_asset_id_key"
  ON "engagement_review_media"("review_id", "media_asset_id");
CREATE INDEX "engagement_review_media_review_id_position_idx"
  ON "engagement_review_media"("review_id", "position");

ALTER TABLE "engagement_review_media"
  ADD CONSTRAINT "engagement_review_media_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "engagement_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engagement_review_media"
  ADD CONSTRAINT "engagement_review_media_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
