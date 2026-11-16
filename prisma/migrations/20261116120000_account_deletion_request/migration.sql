-- Account-deletion request foundation. Adds an unused table.
-- Does not update or delete users, engagements, payments, invoices, or files.

CREATE TYPE "AccountDeletionRequestStatus" AS ENUM ('pending', 'withdrawn', 'closed');

CREATE TABLE "account_deletion_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "AccountDeletionRequestStatus" NOT NULL DEFAULT 'pending',
  "self_requested_at" TIMESTAMP(3),
  "self_idempotency_key" VARCHAR(128),
  "staff_requested_at" TIMESTAMP(3),
  "staff_member_id" UUID,
  "staff_reason" VARCHAR(500),
  "staff_idempotency_key" VARCHAR(128),
  "closure_idempotency_key" VARCHAR(128),
  "completion_email" CITEXT,
  "completion_email_expires_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_deletion_requests_closure_idempotency_key_key"
  ON "account_deletion_requests"("closure_idempotency_key");
CREATE INDEX "account_deletion_requests_user_id_idx" ON "account_deletion_requests"("user_id");
CREATE INDEX "account_deletion_requests_staff_member_id_idx" ON "account_deletion_requests"("staff_member_id");
CREATE UNIQUE INDEX "account_deletion_requests_one_pending_per_user"
  ON "account_deletion_requests"("user_id")
  WHERE "status" = 'pending';

ALTER TABLE "account_deletion_requests"
  ADD CONSTRAINT "account_deletion_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_deletion_requests"
  ADD CONSTRAINT "account_deletion_requests_staff_member_id_fkey"
  FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_deletion_requests_origins'
      AND conrelid = 'public.account_deletion_requests'::regclass
  ) THEN
    ALTER TABLE "account_deletion_requests"
      ADD CONSTRAINT "account_deletion_requests_origins" CHECK (
        (
          "staff_member_id" IS NULL
          AND "staff_requested_at" IS NULL
          AND "staff_reason" IS NULL
        )
        OR (
          "staff_member_id" IS NOT NULL
          AND "staff_requested_at" IS NOT NULL
          AND "staff_reason" IS NOT NULL
        )
      );
  END IF;
END $$;
