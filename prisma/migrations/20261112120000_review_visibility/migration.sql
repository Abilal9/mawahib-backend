-- Staff visibility for engagement reviews. Does not change existing rows,
-- report status, engagements, payments, or invoices.
-- New enum values are not used in this migration.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'review_hidden';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'review_restored';

ALTER TABLE "engagement_reviews" ADD COLUMN IF NOT EXISTS "staff_hidden_at" TIMESTAMP(3);
ALTER TABLE "engagement_reviews" ADD COLUMN IF NOT EXISTS "moderation_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "staff_audit_events" ADD COLUMN IF NOT EXISTS "target_review_id" UUID;

CREATE INDEX IF NOT EXISTS "staff_audit_events_target_review_id_created_at_idx"
  ON "staff_audit_events"("target_review_id", "created_at" DESC);
