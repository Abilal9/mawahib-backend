-- Staff closure of in-progress, delivered, or disputed work, plus a separate
-- financial follow-up record. Does not rewrite payments, invoices, events, or
-- existing closures. A missing row means follow-up was not recorded.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'staff_financial_follow_up_recorded';

CREATE TYPE "StaffClosureVia" AS ENUM ('dispute_case', 'engagement');
CREATE TYPE "StaffClosureInitiation" AS ENUM ('report', 'support_request', 'staff_observation');
CREATE TYPE "FinancialFollowUpOutcome" AS ENUM ('no_real_funds', 'simulated_exercise', 'recorded_outside_provider');

CREATE TABLE "engagement_staff_closures" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "via" "StaffClosureVia" NOT NULL,
  "dispute_case_id" UUID,
  "from_status" "WorkEngagementStatus" NOT NULL,
  "closed_by_staff_member_id" UUID NOT NULL,
  "closed_at" TIMESTAMP(3) NOT NULL,
  "initiation_category" "StaffClosureInitiation" NOT NULL,
  "initiation_report_id" UUID,
  "initiation_reference" VARCHAR(120),
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "follow_up_required" BOOLEAN NOT NULL,
  "follow_up_outcome" "FinancialFollowUpOutcome",
  "follow_up_note" VARCHAR(500),
  "follow_up_recorded_at" TIMESTAMP(3),
  "follow_up_recorded_by_staff_member_id" UUID,
  "follow_up_idempotency_key" VARCHAR(128),
  "follow_up_request_hash" CHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "engagement_staff_closures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engagement_staff_closures_engagement_id_key" ON "engagement_staff_closures"("engagement_id");
CREATE UNIQUE INDEX "engagement_staff_closures_dispute_case_id_key" ON "engagement_staff_closures"("dispute_case_id");
CREATE INDEX "engagement_staff_closures_closed_by_staff_member_id_idx" ON "engagement_staff_closures"("closed_by_staff_member_id");
CREATE INDEX "engagement_staff_closures_initiation_report_id_idx" ON "engagement_staff_closures"("initiation_report_id");
CREATE INDEX "engagement_staff_closures_follow_up_recorded_by_staff_member_id_idx" ON "engagement_staff_closures"("follow_up_recorded_by_staff_member_id");
CREATE INDEX "engagement_staff_closures_outstanding_follow_up_idx" ON "engagement_staff_closures"("closed_at" DESC) WHERE "follow_up_required" = true AND "follow_up_outcome" IS NULL;

ALTER TABLE "engagement_staff_closures" ADD CONSTRAINT "engagement_staff_closures_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engagement_staff_closures" ADD CONSTRAINT "engagement_staff_closures_dispute_case_id_fkey" FOREIGN KEY ("dispute_case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engagement_staff_closures" ADD CONSTRAINT "engagement_staff_closures_closed_by_staff_member_id_fkey" FOREIGN KEY ("closed_by_staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engagement_staff_closures" ADD CONSTRAINT "engagement_staff_closures_initiation_report_id_fkey" FOREIGN KEY ("initiation_report_id") REFERENCES "content_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engagement_staff_closures" ADD CONSTRAINT "engagement_staff_closures_follow_up_recorded_by_staff_member_id_fkey" FOREIGN KEY ("follow_up_recorded_by_staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_staff_closures_shape'
      AND conrelid = 'public.engagement_staff_closures'::regclass
  ) THEN
    ALTER TABLE "engagement_staff_closures"
      ADD CONSTRAINT "engagement_staff_closures_shape" CHECK (
        (("via" = 'dispute_case') = ("dispute_case_id" IS NOT NULL))
        AND "from_status" IN ('in_progress', 'delivered', 'disputed')
        AND (
          ("initiation_category" = 'report' AND "initiation_report_id" IS NOT NULL AND "initiation_reference" IS NULL)
          OR ("initiation_category" = 'support_request' AND "initiation_report_id" IS NULL AND "initiation_reference" IS NOT NULL)
          OR ("initiation_category" = 'staff_observation' AND "initiation_report_id" IS NULL AND "initiation_reference" IS NULL)
        )
        AND (
          (
            "follow_up_outcome" IS NULL
            AND "follow_up_note" IS NULL
            AND "follow_up_recorded_at" IS NULL
            AND "follow_up_recorded_by_staff_member_id" IS NULL
            AND "follow_up_idempotency_key" IS NULL
            AND "follow_up_request_hash" IS NULL
          )
          OR (
            "follow_up_required" = true
            AND "follow_up_outcome" IS NOT NULL
            AND "follow_up_note" IS NOT NULL
            AND "follow_up_recorded_at" IS NOT NULL
            AND "follow_up_recorded_by_staff_member_id" IS NOT NULL
            AND "follow_up_idempotency_key" IS NOT NULL
            AND "follow_up_request_hash" IS NOT NULL
          )
        )
      );
  END IF;
END $$;
