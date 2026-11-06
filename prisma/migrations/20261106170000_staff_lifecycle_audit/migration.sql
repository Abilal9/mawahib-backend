-- Records staff invitation activation and deactivation.
-- Does not rewrite earlier staff migrations.
-- New values are not used in this migration.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'membership_activated';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'membership_deactivated';
ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'membership_emergency_deactivated';
