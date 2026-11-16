-- Durable cleanup tasks for a closed account. Does not change existing users or marketplace rows.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'account_deleted';

CREATE TYPE "AccountDeletionCleanupKind" AS ENUM ('auth_user', 'storage_object', 'completion_email');
CREATE TYPE "AccountDeletionCleanupStatus" AS ENUM ('pending', 'succeeded');

CREATE TABLE "account_deletion_cleanup_tasks" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" "AccountDeletionCleanupKind" NOT NULL,
  "bucket" TEXT,
  "object_key" TEXT,
  "status" "AccountDeletionCleanupStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(500),
  "next_attempt_at" TIMESTAMP(3),
  "claimed_at" TIMESTAMP(3),
  "claim_token" UUID,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_deletion_cleanup_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_deletion_cleanup_tasks_status_next_attempt_at_idx"
  ON "account_deletion_cleanup_tasks"("status", "next_attempt_at");
CREATE INDEX "account_deletion_cleanup_tasks_user_id_kind_idx"
  ON "account_deletion_cleanup_tasks"("user_id", "kind");

ALTER TABLE "account_deletion_cleanup_tasks"
  ADD CONSTRAINT "account_deletion_cleanup_tasks_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "account_deletion_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
