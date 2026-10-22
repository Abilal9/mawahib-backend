-- Operational civil dates for an accepted engagement.
-- One row per engagement. Flexible work and unresolved durations have no row.
-- dueAt and deadline_label are left untouched.

CREATE TYPE "EngagementScheduleKind" AS ENUM ('deadline', 'deadline_range');

CREATE TYPE "EngagementScheduleSource" AS ENUM ('agreed_terms', 'resolved_duration');

CREATE TABLE "engagement_schedules" (
    "engagement_id" UUID NOT NULL,
    "kind" "EngagementScheduleKind" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "source" "EngagementScheduleSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_schedules_pkey" PRIMARY KEY ("engagement_id")
);

CREATE INDEX "engagement_schedules_start_date_end_date_idx"
    ON "engagement_schedules"("start_date", "end_date");

ALTER TABLE "engagement_schedules"
    ADD CONSTRAINT "engagement_schedules_engagement_id_fkey"
    FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engagement_schedules"
    ADD CONSTRAINT "engagement_schedules_start_not_after_end"
    CHECK ("start_date" <= "end_date");

ALTER TABLE "engagement_schedules"
    ADD CONSTRAINT "engagement_schedules_deadline_is_one_day"
    CHECK ("kind" <> 'deadline' OR "start_date" = "end_date");

ALTER TABLE "engagement_schedules"
    ADD CONSTRAINT "engagement_schedules_resolved_duration_is_deadline"
    CHECK ("source" <> 'resolved_duration' OR "kind" = 'deadline');

-- Exception-safe parsers. Dropped at the end of this migration.
CREATE FUNCTION engagement_schedule_safe_date(raw text)
RETURNS date
LANGUAGE plpgsql
AS $$
BEGIN
  IF raw IS NULL OR raw !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN raw::date;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE FUNCTION engagement_schedule_duration_end(anchor date, raw_value text, raw_unit text)
RETURNS date
LANGUAGE plpgsql
AS $$
DECLARE
  amount integer;
  unit text;
BEGIN
  IF anchor IS NULL OR raw_value IS NULL OR raw_value !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  amount := raw_value::integer;
  IF amount < 1 OR amount > 3650 THEN
    RETURN NULL;
  END IF;
  unit := lower(btrim(raw_unit));
  IF unit = 'days' THEN
    RETURN anchor + amount;
  ELSIF unit = 'weeks' THEN
    RETURN anchor + (amount * 7);
  ELSIF unit = 'months' THEN
    RETURN (anchor + make_interval(months => amount))::date;
  END IF;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Exact dates and inclusive ranges from the agreed snapshot.
INSERT INTO "engagement_schedules" (
    "engagement_id",
    "kind",
    "start_date",
    "end_date",
    "source",
    "created_at",
    "updated_at"
)
SELECT
    wr."work_engagement_id",
    CASE deadline->>'type'
        WHEN 'exact_date' THEN 'deadline'::"EngagementScheduleKind"
        ELSE 'deadline_range'::"EngagementScheduleKind"
    END,
    CASE deadline->>'type'
        WHEN 'exact_date' THEN engagement_schedule_safe_date(deadline->>'startDate')
        ELSE engagement_schedule_safe_date(deadline->>'startDate')
    END,
    CASE deadline->>'type'
        WHEN 'exact_date' THEN engagement_schedule_safe_date(deadline->>'startDate')
        ELSE engagement_schedule_safe_date(deadline->>'endDate')
    END,
    'agreed_terms'::"EngagementScheduleSource",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "work_requests" wr
CROSS JOIN LATERAL (
    SELECT wr."agreed_terms_json"->'deadline' AS deadline
) parsed
WHERE wr."work_engagement_id" IS NOT NULL
  AND jsonb_typeof(wr."agreed_terms_json") = 'object'
  AND deadline->>'type' IN ('exact_date', 'date_range')
  AND engagement_schedule_safe_date(
        CASE deadline->>'type'
            WHEN 'exact_date' THEN deadline->>'startDate'
            ELSE deadline->>'startDate'
        END
      ) IS NOT NULL
  AND engagement_schedule_safe_date(
        CASE deadline->>'type'
            WHEN 'exact_date' THEN deadline->>'startDate'
            ELSE deadline->>'endDate'
        END
      ) IS NOT NULL
  AND engagement_schedule_safe_date(
        CASE deadline->>'type'
            WHEN 'exact_date' THEN deadline->>'startDate'
            ELSE deadline->>'startDate'
        END
      ) <= engagement_schedule_safe_date(
        CASE deadline->>'type'
            WHEN 'exact_date' THEN deadline->>'startDate'
            ELSE deadline->>'endDate'
        END
      )
ON CONFLICT ("engagement_id") DO NOTHING;

-- Durations anchor on the first pending_payment → in_progress event, in Asia/Riyadh.
INSERT INTO "engagement_schedules" (
    "engagement_id",
    "kind",
    "start_date",
    "end_date",
    "source",
    "created_at",
    "updated_at"
)
SELECT
    wr."work_engagement_id",
    'deadline'::"EngagementScheduleKind",
    resolved.end_on,
    resolved.end_on,
    'resolved_duration'::"EngagementScheduleSource",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "work_requests" wr
JOIN (
    SELECT "engagement_id", MIN("created_at") AS started_at
    FROM "engagement_events"
    WHERE "from_status" = 'pending_payment'
      AND "to_status" = 'in_progress'
    GROUP BY "engagement_id"
) starts ON starts."engagement_id" = wr."work_engagement_id"
CROSS JOIN LATERAL (
    SELECT wr."agreed_terms_json"->'deadline' AS deadline
) parsed
CROSS JOIN LATERAL (
    SELECT engagement_schedule_duration_end(
        ((starts.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Riyadh')::date,
        deadline->>'durationValue',
        deadline->>'durationUnit'
    ) AS end_on
) resolved
WHERE wr."work_engagement_id" IS NOT NULL
  AND jsonb_typeof(wr."agreed_terms_json") = 'object'
  AND deadline->>'type' = 'duration'
  AND resolved.end_on IS NOT NULL
ON CONFLICT ("engagement_id") DO NOTHING;

DROP FUNCTION engagement_schedule_duration_end(date, text, text);
DROP FUNCTION engagement_schedule_safe_date(text);
