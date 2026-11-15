-- Party snapshot and one generation claim for invoices.
-- Does not rewrite existing documents, numbers, payments, or engagements.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payer_display_name" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payee_display_name" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_reference" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "generation_claim_token" UUID;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "generation_claimed_at" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_snapshot_all_or_nothing'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_snapshot_all_or_nothing"
      CHECK (
        (
          "payer_display_name" IS NULL
          AND "payee_display_name" IS NULL
          AND "description" IS NULL
        )
        OR (
          "payer_display_name" IS NOT NULL
          AND "payee_display_name" IS NOT NULL
          AND "description" IS NOT NULL
        )
      );
  END IF;
END $$;

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'invoice_retried';

ALTER TABLE "staff_audit_events" ADD COLUMN IF NOT EXISTS "target_invoice_id" UUID;

CREATE INDEX IF NOT EXISTS "staff_audit_events_target_invoice_id_created_at_idx"
  ON "staff_audit_events"("target_invoice_id", "created_at" DESC);
