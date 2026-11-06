-- Issuer-aware staff membership.
-- One transaction. PostgreSQL rolls every statement back if any step fails
-- before COMMIT, so issuer cannot be committed without the link column,
-- the audit actor column, the unique key, and the foreign keys.
-- Does not rewrite the earlier staff migrations.
-- Does not assign an issuer to rows that already exist.
-- Does not delete staff, audit, or reservation rows.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.staff_members IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.staff_audit_events IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.auth_subject_reservations IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.staff_members) THEN
    RAISE EXCEPTION
      'staff_members already has rows, so this migration stopped. Do not delete staff or staff_audit_events rows to make it pass. Inspect those rows and their audit references, then apply an explicit data-transition plan before trying again.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_audit_events) THEN
    RAISE EXCEPTION
      'staff_audit_events already has rows, so this migration stopped. Do not delete audit history to make it pass. Inspect those records and their subject references, then apply an explicit data-transition plan before trying again.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auth_subject_reservations) THEN
    RAISE EXCEPTION
      'auth_subject_reservations already has rows, so this migration stopped. Do not delete reservation rows to make it pass. A reservation is not disposable because product signup failed or this table is being retired. Inspect the rows and any related history, then apply an explicit data-transition plan before trying again.';
  END IF;
END $$;

ALTER TABLE public.staff_members
  ADD COLUMN issuer TEXT NOT NULL,
  ADD COLUMN linked_product_user_id UUID;

DROP INDEX public.staff_members_subject_id_key;

CREATE UNIQUE INDEX staff_members_issuer_subject_id_key
  ON public.staff_members (issuer, subject_id);

CREATE UNIQUE INDEX staff_members_linked_product_user_id_key
  ON public.staff_members (linked_product_user_id);

ALTER TABLE public.staff_members
  ADD CONSTRAINT staff_members_linked_product_user_id_fkey
  FOREIGN KEY (linked_product_user_id) REFERENCES public.users (id)
  ON DELETE SET NULL;

ALTER TABLE public.staff_audit_events
  ADD COLUMN actor_staff_member_id UUID;

ALTER TABLE public.staff_audit_events
  ADD CONSTRAINT staff_audit_events_actor_staff_member_id_fkey
  FOREIGN KEY (actor_staff_member_id) REFERENCES public.staff_members (id)
  ON DELETE RESTRICT;

CREATE INDEX staff_audit_events_actor_staff_member_id_idx
  ON public.staff_audit_events (actor_staff_member_id);

DROP TABLE public.auth_subject_reservations;
DROP TYPE "AuthSubjectKind";

COMMENT ON COLUMN public.staff_members.issuer IS
  'Trusted staff Auth issuer. Not taken from a browser request.';
COMMENT ON COLUMN public.staff_members.linked_product_user_id IS
  'Optional explicit product account. Email equality does not set this.';
COMMENT ON COLUMN public.staff_audit_events.actor_staff_member_id IS
  'Portal actor. Local commands keep using unverified_process_user instead.';

COMMIT;
