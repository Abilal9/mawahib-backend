-- Staff dispute cases. Additive. Does not rewrite earlier migrations or existing rows.
-- One case is opened for each engagement event that enters disputed.
-- Engagements that are disputed when this migration runs receive one open case.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TYPE "DisputeCaseStatus" AS ENUM ('open', 'in_review', 'closed');
CREATE TYPE "DisputeCaseOutcome" AS ENUM (
  'parties_resolved',
  'no_staff_action',
  'payment_follow_up',
  'invalid_or_duplicate',
  'other'
);
CREATE TYPE "DisputeCaseOrigin" AS ENUM ('dispute_event', 'existing_dispute');
CREATE TYPE "DisputeCaseAction" AS ENUM (
  'review_started',
  'closed',
  'reopened',
  'assigned',
  'reassigned',
  'unassigned',
  'note_added'
);

CREATE TABLE "dispute_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "engagement_id" UUID NOT NULL,
  "opened_event_id" UUID,
  "origin" "DisputeCaseOrigin" NOT NULL,
  "status" "DisputeCaseStatus" NOT NULL DEFAULT 'open',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "is_latest" BOOLEAN NOT NULL DEFAULT true,
  "assignee_staff_member_id" UUID,
  "assigned_at" TIMESTAMP(3),
  "status_changed_at" TIMESTAMP(3),
  "closed_outcome" "DisputeCaseOutcome",
  "closed_note" VARCHAR(500),
  "closed_at" TIMESTAMP(3),
  "closed_by_staff_member_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dispute_cases_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "dispute_cases_closed_fields_check" CHECK (
    ("status" = 'closed') = (
      "closed_outcome" IS NOT NULL
      AND "closed_note" IS NOT NULL
      AND "closed_at" IS NOT NULL
      AND "closed_by_staff_member_id" IS NOT NULL
    )
  ),
  CONSTRAINT "dispute_cases_event_origin_check" CHECK (
    "origin" <> 'dispute_event' OR "opened_event_id" IS NOT NULL
  )
);

CREATE TABLE "dispute_case_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "action" "DisputeCaseAction" NOT NULL,
  "actor_staff_member_id" UUID NOT NULL,
  "actor_subject_id" UUID NOT NULL,
  "previous_status" "DisputeCaseStatus" NOT NULL,
  "resulting_status" "DisputeCaseStatus" NOT NULL,
  "previous_assignee_staff_member_id" UUID,
  "resulting_assignee_staff_member_id" UUID,
  "previous_revision" INTEGER NOT NULL,
  "resulting_revision" INTEGER NOT NULL,
  "outcome" "DisputeCaseOutcome",
  "note" TEXT NOT NULL,
  "engagement_status_at_action" "WorkEngagementStatus",
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_case_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dispute_case_events_note_check" CHECK (char_length("note") BETWEEN 1 AND 2000)
);

CREATE UNIQUE INDEX "dispute_cases_opened_event_id_key" ON "dispute_cases"("opened_event_id");
CREATE INDEX "dispute_cases_created_at_id_idx" ON "dispute_cases"("created_at" DESC, "id" DESC);
CREATE INDEX "dispute_cases_status_created_at_id_idx" ON "dispute_cases"("status", "created_at" DESC, "id" DESC);
CREATE INDEX "dispute_cases_assignee_staff_member_id_status_idx" ON "dispute_cases"("assignee_staff_member_id", "status");
CREATE INDEX "dispute_cases_engagement_id_created_at_idx" ON "dispute_cases"("engagement_id", "created_at" DESC);
CREATE INDEX "dispute_cases_closed_by_staff_member_id_idx" ON "dispute_cases"("closed_by_staff_member_id");
CREATE UNIQUE INDEX "dispute_cases_one_latest_per_engagement" ON "dispute_cases"("engagement_id") WHERE "is_latest";
CREATE UNIQUE INDEX "dispute_case_events_case_id_actor_staff_member_id_idempotency_key_key"
  ON "dispute_case_events"("case_id", "actor_staff_member_id", "idempotency_key");
CREATE INDEX "dispute_case_events_case_id_created_at_id_idx" ON "dispute_case_events"("case_id", "created_at", "id");
CREATE INDEX "dispute_case_events_actor_staff_member_id_idx" ON "dispute_case_events"("actor_staff_member_id");

ALTER TABLE "dispute_cases"
  ADD CONSTRAINT "dispute_cases_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases"
  ADD CONSTRAINT "dispute_cases_opened_event_id_fkey"
  FOREIGN KEY ("opened_event_id") REFERENCES "engagement_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases"
  ADD CONSTRAINT "dispute_cases_assignee_staff_member_id_fkey"
  FOREIGN KEY ("assignee_staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases"
  ADD CONSTRAINT "dispute_cases_closed_by_staff_member_id_fkey"
  FOREIGN KEY ("closed_by_staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_events"
  ADD CONSTRAINT "dispute_case_events_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_events"
  ADD CONSTRAINT "dispute_case_events_actor_staff_member_id_fkey"
  FOREIGN KEY ("actor_staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION open_dispute_case_on_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE dispute_cases
  SET is_latest = false
  WHERE engagement_id = NEW.engagement_id
    AND is_latest;
  INSERT INTO dispute_cases (
    id, engagement_id, opened_event_id, origin, status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.engagement_id,
    NEW.id,
    'dispute_event',
    'open',
    NEW.created_at,
    NEW.created_at
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER engagement_events_open_dispute_case
AFTER INSERT ON engagement_events
FOR EACH ROW
WHEN (NEW.to_status = 'disputed')
EXECUTE FUNCTION open_dispute_case_on_event();

INSERT INTO dispute_cases (id, engagement_id, opened_event_id, origin, status, created_at, updated_at)
SELECT gen_random_uuid(), e.id, ev.id, 'existing_dispute', 'open', COALESCE(ev.created_at, e.updated_at), CURRENT_TIMESTAMP
FROM work_engagements e
LEFT JOIN LATERAL (
  SELECT id, created_at FROM engagement_events
  WHERE engagement_id = e.id AND to_status = 'disputed'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
) ev ON true
WHERE e.status = 'disputed'
  AND NOT EXISTS (SELECT 1 FROM dispute_cases c WHERE c.engagement_id = e.id);

CREATE FUNCTION dispute_case_events_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'dispute_case_events is append-only';
END;
$$;

CREATE TRIGGER dispute_case_events_append_only
BEFORE UPDATE OR DELETE ON dispute_case_events
FOR EACH ROW
EXECUTE FUNCTION dispute_case_events_reject_mutation();

REVOKE ALL ON TABLE public.dispute_cases FROM anon, authenticated;
REVOKE ALL ON TABLE public.dispute_case_events FROM anon, authenticated;
ALTER TABLE public.dispute_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_case_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dispute_cases IS
  'Staff handling of one dispute episode. RLS on, no PostgREST policies. Does not change the engagement.';
COMMENT ON TABLE public.dispute_case_events IS
  'Append-only staff case audit and internal notes. RLS on, no PostgREST policies.';

COMMIT;
