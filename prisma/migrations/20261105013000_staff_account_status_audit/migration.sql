-- Extends staff audit for portal account-status changes.
-- Does not rewrite the staff-foundation migration.
-- New enum values are not used in this migration.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TYPE "StaffAuditAction" ADD VALUE 'account_suspended';
ALTER TYPE "StaffAuditAction" ADD VALUE 'account_restored';

ALTER TABLE "staff_audit_events" ALTER COLUMN "unverified_process_user" DROP NOT NULL;

ALTER TABLE "staff_audit_events"
  ADD COLUMN "actor_subject_id" UUID,
  ADD COLUMN "target_account_id" UUID,
  ADD COLUMN "previous_status" "AccountStatus",
  ADD COLUMN "resulting_status" "AccountStatus",
  ADD COLUMN "reason" TEXT;

ALTER TABLE "staff_audit_events"
  ADD CONSTRAINT "staff_audit_events_reason_length"
  CHECK ("reason" IS NULL OR char_length("reason") <= 500);

CREATE INDEX "staff_audit_events_created_at_id_idx"
  ON "staff_audit_events" ("created_at" DESC, "id" DESC);

CREATE INDEX "staff_audit_events_target_account_created_at_id_idx"
  ON "staff_audit_events" ("target_account_id", "created_at" DESC, "id" DESC);

COMMIT;
