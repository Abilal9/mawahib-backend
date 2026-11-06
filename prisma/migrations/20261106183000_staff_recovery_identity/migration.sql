-- Distinguishes lost-factor recovery from intentional removal.
-- Stores the invitation email as confirmation evidence.
-- Does not rewrite earlier staff migrations.
-- New enum values are not used in this migration.

ALTER TYPE "StaffMembershipStatus" ADD VALUE IF NOT EXISTS 'recovery';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'membership_factor_recovery_started';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'membership_reenrollment_permitted';

ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "invited_email" text;
