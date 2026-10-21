-- Per-record description used only when the canonical category is Other.
-- A row with no category cannot store this text.

ALTER TABLE "service_offerings" ADD COLUMN "custom_category" VARCHAR(60);
ALTER TABLE "job_listings" ADD COLUMN "custom_category" VARCHAR(60);

ALTER TABLE "service_offerings"
  ADD CONSTRAINT "service_offerings_custom_category_requires_category"
  CHECK ("custom_category" IS NULL OR "category_id" IS NOT NULL);

ALTER TABLE "job_listings"
  ADD CONSTRAINT "job_listings_custom_category_requires_category"
  CHECK ("custom_category" IS NULL OR "category_id" IS NOT NULL);
