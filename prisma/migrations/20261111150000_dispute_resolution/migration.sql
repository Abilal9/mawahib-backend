-- Additive dispute-resolution outcomes and the engagement status after a staff action.
-- Does not rewrite applied migrations, engagement rows, payments, or invoices.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TYPE "DisputeCaseOutcome" ADD VALUE IF NOT EXISTS 'returned_for_client_review';
ALTER TYPE "DisputeCaseOutcome" ADD VALUE IF NOT EXISTS 'further_work_agreed';
ALTER TYPE "DisputeCaseAction" ADD VALUE IF NOT EXISTS 'follow_up_recorded';
ALTER TYPE "DisputeCaseAction" ADD VALUE IF NOT EXISTS 'returned_for_client_review';
ALTER TYPE "DisputeCaseAction" ADD VALUE IF NOT EXISTS 'further_work_agreed';

ALTER TABLE "dispute_case_events"
  ADD COLUMN IF NOT EXISTS "engagement_resulting_status" "WorkEngagementStatus";

COMMIT;
