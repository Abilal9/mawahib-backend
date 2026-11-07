-- Product reports for staff review. Additive. Does not rewrite earlier migrations.
-- New StaffAuditAction values are not inserted in this migration.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'report_resolved';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'report_dismissed';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'report_reopened';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TYPE "ReportTargetType" AS ENUM ('post_comment', 'work_request');
CREATE TYPE "ReportReason" AS ENUM (
  'spam',
  'harassment',
  'hate_or_violence',
  'sexual_content',
  'scam_or_fraud',
  'impersonation',
  'illegal_or_dangerous',
  'other'
);
CREATE TYPE "ReportStatus" AS ENUM ('open', 'resolved', 'dismissed');

CREATE TABLE "content_reports" (
  "id" UUID NOT NULL,
  "reporter_user_id" UUID,
  "target_type" "ReportTargetType" NOT NULL,
  "target_id" UUID NOT NULL,
  "reported_user_id" UUID,
  "context_post_id" UUID,
  "reason" "ReportReason" NOT NULL,
  "details" VARCHAR(1000),
  "status" "ReportStatus" NOT NULL DEFAULT 'open',
  "status_changed_at" TIMESTAMP(3),
  "status_changed_by_staff_member_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "staff_audit_events" ADD COLUMN "target_report_id" UUID;

CREATE INDEX "content_reports_status_created_at_id_idx"
  ON "content_reports"("status", "created_at" DESC, "id" DESC);
CREATE INDEX "content_reports_target_type_status_created_at_id_idx"
  ON "content_reports"("target_type", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "content_reports_reporter_user_id_created_at_idx"
  ON "content_reports"("reporter_user_id", "created_at");
CREATE UNIQUE INDEX "content_reports_one_open_per_target"
  ON "content_reports"("reporter_user_id", "target_type", "target_id")
  WHERE "status" = 'open';
CREATE INDEX "staff_audit_events_target_report_id_created_at_idx"
  ON "staff_audit_events"("target_report_id", "created_at" DESC);

ALTER TABLE "content_reports"
  ADD CONSTRAINT "content_reports_reporter_user_id_fkey"
  FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_reports"
  ADD CONSTRAINT "content_reports_reported_user_id_fkey"
  FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_reports"
  ADD CONSTRAINT "content_reports_status_changed_by_staff_member_id_fkey"
  FOREIGN KEY ("status_changed_by_staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_audit_events"
  ADD CONSTRAINT "staff_audit_events_target_report_id_fkey"
  FOREIGN KEY ("target_report_id") REFERENCES "content_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE ALL ON TABLE public.content_reports FROM anon, authenticated;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.content_reports IS
  'Product reports reviewed by staff. RLS on, no PostgREST policies. Reporter identity is not a product-readable column.';

COMMIT;
