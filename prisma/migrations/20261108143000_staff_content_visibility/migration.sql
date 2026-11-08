-- Reversible staff visibility for posts and comments.
-- Does not change existing rows, report status, or stored notification text.
-- New enum values are not used in this migration.
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'post_hidden';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'post_restored';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'comment_hidden';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'comment_restored';

ALTER TABLE "posts" ADD COLUMN "staff_hidden_at" TIMESTAMP(3);
ALTER TABLE "posts" ADD COLUMN "moderation_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "post_comments" ADD COLUMN "staff_hidden_at" TIMESTAMP(3);
ALTER TABLE "post_comments" ADD COLUMN "moderation_version" INTEGER NOT NULL DEFAULT 0;

-- No foreign keys: the audit row must remain after the post or comment is deleted.
ALTER TABLE "staff_audit_events" ADD COLUMN "target_post_id" UUID;
ALTER TABLE "staff_audit_events" ADD COLUMN "target_comment_id" UUID;

CREATE INDEX "staff_audit_events_target_post_id_created_at_idx"
  ON "staff_audit_events"("target_post_id", "created_at" DESC);

CREATE INDEX "staff_audit_events_target_comment_id_created_at_idx"
  ON "staff_audit_events"("target_comment_id", "created_at" DESC);
