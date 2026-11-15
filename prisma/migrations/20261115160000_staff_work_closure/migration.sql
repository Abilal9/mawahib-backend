-- Staff closure of disputed work. Does not rewrite historical events,
-- payments, invoices, or review windows.

ALTER TYPE "DisputeCaseOutcome" ADD VALUE IF NOT EXISTS 'closed_by_mawahib';
ALTER TYPE "DisputeCaseAction" ADD VALUE IF NOT EXISTS 'work_closed';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'staff_work_closed';

ALTER TABLE "work_engagements" ADD COLUMN IF NOT EXISTS "staff_closed_at" TIMESTAMP(3);
