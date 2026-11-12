-- Staff visibility for jobs and services. Does not change listing status,
-- applications, engagements, payments, invoices, or reports.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'job_hidden';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'job_restored';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'service_hidden';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'service_restored';

ALTER TABLE "job_listings" ADD COLUMN IF NOT EXISTS "staff_hidden_at" TIMESTAMP(3);
ALTER TABLE "job_listings" ADD COLUMN IF NOT EXISTS "moderation_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "service_offerings" ADD COLUMN IF NOT EXISTS "staff_hidden_at" TIMESTAMP(3);
ALTER TABLE "service_offerings" ADD COLUMN IF NOT EXISTS "moderation_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "staff_audit_events" ADD COLUMN IF NOT EXISTS "target_job_listing_id" UUID;
ALTER TABLE "staff_audit_events" ADD COLUMN IF NOT EXISTS "target_service_offering_id" UUID;

CREATE INDEX IF NOT EXISTS "staff_audit_events_target_job_listing_id_created_at_idx"
  ON "staff_audit_events"("target_job_listing_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "staff_audit_events_target_service_offering_id_created_at_idx"
  ON "staff_audit_events"("target_service_offering_id", "created_at" DESC);
