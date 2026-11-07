-- New report targets. Existing rows and the open-report index stay unchanged.
-- These values are not used in this migration.
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'user';
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'post';
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'engagement_review';
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'job_listing';
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'service_offering';
