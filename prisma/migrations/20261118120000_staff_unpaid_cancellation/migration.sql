-- Staff cancellation of accepted unpaid work.
-- Separate from paid-work closure. Does not set staff_closed_at
-- and does not rewrite payments, invoices, or follow-up records.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'staff_unpaid_work_cancelled';

CREATE TABLE "staff_unpaid_cancellations" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_unpaid_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_unpaid_cancellations_engagement_id_key" ON "staff_unpaid_cancellations"("engagement_id");
CREATE INDEX "staff_unpaid_cancellations_staff_member_id_idx" ON "staff_unpaid_cancellations"("staff_member_id");

ALTER TABLE "staff_unpaid_cancellations" ADD CONSTRAINT "staff_unpaid_cancellations_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_unpaid_cancellations" ADD CONSTRAINT "staff_unpaid_cancellations_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
