-- Additive account access gate.
-- Existing rows receive ACTIVE from the column default.
-- No data rewrite, no dropped columns, no auth-user changes.

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "users"
ADD COLUMN "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';
