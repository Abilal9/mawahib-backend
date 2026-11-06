-- Records an explicit return from inactive membership to pending.
-- Does not rewrite earlier staff migrations.
-- The new value is not used in this migration.

ALTER TYPE "StaffAuditAction" ADD VALUE IF NOT EXISTS 'membership_readmitted';
