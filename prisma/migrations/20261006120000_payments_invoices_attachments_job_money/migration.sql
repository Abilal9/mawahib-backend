-- Media purposes for commercial attachments + invoices
ALTER TYPE "MediaPurpose" ADD VALUE 'work_request';
ALTER TYPE "MediaPurpose" ADD VALUE 'invoice';

-- Job structured compensation
CREATE TYPE "JobPricingType" AS ENUM ('fixed', 'range', 'negotiable');

ALTER TABLE "job_listings"
  ADD COLUMN "pricing_type" "JobPricingType" NOT NULL DEFAULT 'negotiable',
  ADD COLUMN "fixed_amount" DECIMAL(12,2),
  ADD COLUMN "min_amount" DECIMAL(12,2),
  ADD COLUMN "max_amount" DECIMAL(12,2);

-- Payment enums + table
CREATE TYPE "PaymentMethod" AS ENUM ('apple_pay', 'card');
CREATE TYPE "PaymentProviderKind" AS ENUM ('mock');
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'cancelled');

CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "payer_user_id" UUID NOT NULL,
  "payee_user_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "provider" "PaymentProviderKind" NOT NULL DEFAULT 'mock',
  "provider_reference" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
  "idempotency_key" TEXT NOT NULL,
  "settlement_key" TEXT,
  "mock_method_token" TEXT,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "succeeded_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE UNIQUE INDEX "payments_settlement_key_key" ON "payments"("settlement_key");
CREATE INDEX "payments_engagement_id_status_idx" ON "payments"("engagement_id", "status");
CREATE INDEX "payments_payer_user_id_idx" ON "payments"("payer_user_id");
CREATE INDEX "payments_payee_user_id_idx" ON "payments"("payee_user_id");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_payer_user_id_fkey"
  FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_payee_user_id_fkey"
  FOREIGN KEY ("payee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoice enums + table
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'generated', 'failed');
CREATE TYPE "InvoiceProviderKind" AS ENUM ('mock');

CREATE TABLE "invoices" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "provider" "InvoiceProviderKind" NOT NULL DEFAULT 'mock',
  "provider_reference" TEXT,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
  "currency" CHAR(3) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "document_media_asset_id" UUID,
  "original_file_name" TEXT,
  "failure_message" TEXT,
  "issued_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX "invoices_engagement_id_idx" ON "invoices"("engagement_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_document_media_asset_id_fkey"
  FOREIGN KEY ("document_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Work request attachments
CREATE TABLE "work_request_attachments" (
  "id" UUID NOT NULL,
  "work_request_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "original_file_name" TEXT NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_request_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_request_attachments_work_request_id_media_asset_id_key"
  ON "work_request_attachments"("work_request_id", "media_asset_id");
CREATE INDEX "work_request_attachments_work_request_id_idx"
  ON "work_request_attachments"("work_request_id");
CREATE INDEX "work_request_attachments_uploaded_by_user_id_idx"
  ON "work_request_attachments"("uploaded_by_user_id");

ALTER TABLE "work_request_attachments"
  ADD CONSTRAINT "work_request_attachments_work_request_id_fkey"
  FOREIGN KEY ("work_request_id") REFERENCES "work_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_request_attachments"
  ADD CONSTRAINT "work_request_attachments_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_request_attachments"
  ADD CONSTRAINT "work_request_attachments_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
