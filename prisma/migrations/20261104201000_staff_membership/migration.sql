-- Staff membership is backend-only. RLS on, no policies, no Data API grants.
-- Do not FORCE RLS. Nest/Prisma uses the table owner, which bypasses RLS.
-- No extra database role is created.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TYPE "AuthSubjectKind" AS ENUM ('product', 'staff');
CREATE TYPE "StaffMembershipStatus" AS ENUM ('pending', 'active', 'inactive');
CREATE TYPE "StaffRole" AS ENUM ('operator');
CREATE TYPE "StaffAuditAction" AS ENUM ('membership_pending_recorded');

CREATE TABLE "auth_subject_reservations" (
    "subject_id" UUID NOT NULL,
    "kind" "AuthSubjectKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_subject_reservations_pkey" PRIMARY KEY ("subject_id")
);

CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'operator',
    "status" "StaffMembershipStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_members_subject_id_key" ON "staff_members"("subject_id");

CREATE TABLE "staff_audit_events" (
    "id" UUID NOT NULL,
    "action" "StaffAuditAction" NOT NULL,
    "target_subject_id" UUID NOT NULL,
    "unverified_process_user" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_audit_events_target_subject_id_created_at_idx"
    ON "staff_audit_events"("target_subject_id", "created_at");

REVOKE ALL ON TABLE public.auth_subject_reservations FROM anon, authenticated;
REVOKE ALL ON TABLE public.staff_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.staff_audit_events FROM anon, authenticated;

ALTER TABLE public.auth_subject_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_audit_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.staff_members IS
  'Dedicated staff identities for Nest admin routes. RLS on, no PostgREST policies, no product-user foreign key.';
COMMENT ON TABLE public.auth_subject_reservations IS
  'One Auth subject is reserved as product or staff. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.staff_audit_events IS
  'Append-only staff command record. RLS on, no PostgREST policies.';

COMMIT;
