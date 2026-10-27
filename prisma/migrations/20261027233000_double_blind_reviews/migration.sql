-- Double-blind verified engagement reviews.
-- Publication is derived. Stored user/service averages are removed.
-- Nest owns the table. PostgREST stays locked down. RLS is not forced.

ALTER TABLE "work_engagements"
  ADD COLUMN "review_window_closes_at" TIMESTAMP(3);

ALTER TABLE "engagement_reviews"
  ADD COLUMN "reviewee_id" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "work_engagements" e
    WHERE e.status = 'completed'::"WorkEngagementStatus"
      AND e.completed_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "engagement_events" ev
        WHERE ev.engagement_id = e.id
          AND ev.to_status = 'completed'::"WorkEngagementStatus"
      )
  ) THEN
    RAISE EXCEPTION 'completed engagement has no completion event and no completed_at';
  END IF;
END $$;

UPDATE "work_engagements" e
SET "completed_at" = src.completed_at
FROM (
  SELECT engagement_id, MIN(created_at) AS completed_at
  FROM "engagement_events"
  WHERE to_status = 'completed'::"WorkEngagementStatus"
  GROUP BY engagement_id
) src
WHERE e.id = src.engagement_id
  AND e.status = 'completed'::"WorkEngagementStatus"
  AND e.completed_at IS NULL;

UPDATE "work_engagements"
SET "review_window_closes_at" = "completed_at" + interval '14 days'
WHERE status = 'completed'::"WorkEngagementStatus"
  AND "completed_at" IS NOT NULL
  AND "review_window_closes_at" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "work_engagements"
    WHERE status = 'completed'::"WorkEngagementStatus"
      AND ("completed_at" IS NULL OR "review_window_closes_at" IS NULL)
  ) THEN
    RAISE EXCEPTION 'completed engagement is missing completed_at or review_window_closes_at';
  END IF;
END $$;

UPDATE "engagement_reviews" r
SET "reviewee_id" = CASE
  WHEN r.reviewer_id = e.client_id THEN e.provider_id
  WHEN r.reviewer_id = e.provider_id THEN e.client_id
  ELSE NULL
END
FROM "work_engagements" e
WHERE r.engagement_id = e.id
  AND r.reviewee_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "engagement_reviews" r
    JOIN "work_engagements" e ON e.id = r.engagement_id
    WHERE r.reviewer_id <> e.client_id
      AND r.reviewer_id <> e.provider_id
  ) THEN
    RAISE EXCEPTION 'review reviewer is not an engagement participant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "engagement_reviews"
    WHERE reviewee_id IS NULL OR reviewer_id = reviewee_id
  ) THEN
    RAISE EXCEPTION 'review reviewee could not be derived or is a self-review';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "engagement_reviews" r
    JOIN "work_engagements" e ON e.id = r.engagement_id
    WHERE NOT (
      (r.reviewer_id = e.client_id AND r.reviewee_id = e.provider_id)
      OR (r.reviewer_id = e.provider_id AND r.reviewee_id = e.client_id)
    )
  ) THEN
    RAISE EXCEPTION 'review parties are not the two engagement participants';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "engagement_reviews" WHERE rating < 1 OR rating > 5
  ) THEN
    RAISE EXCEPTION 'review rating is outside 1..5';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "engagement_reviews" r
    JOIN "work_engagements" e ON e.id = r.engagement_id
    WHERE e.status <> 'completed'::"WorkEngagementStatus"
  ) THEN
    RAISE EXCEPTION 'review belongs to a non-completed engagement';
  END IF;
END $$;

ALTER TABLE "engagement_reviews"
  ALTER COLUMN "reviewee_id" SET NOT NULL;

ALTER TABLE "engagement_reviews"
  DROP CONSTRAINT "engagement_reviews_engagement_id_fkey";
ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engagement_reviews"
  DROP CONSTRAINT "engagement_reviews_reviewer_id_fkey";
ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_reviewee_id_fkey"
  FOREIGN KEY ("reviewee_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "engagement_reviews_engagement_id_reviewee_id_key"
  ON "engagement_reviews"("engagement_id", "reviewee_id");

CREATE INDEX "engagement_reviews_reviewee_id_created_at_id_idx"
  ON "engagement_reviews"("reviewee_id", "created_at" DESC, "id" DESC);

CREATE INDEX "work_engagements_service_offering_id_idx"
  ON "work_engagements"("service_offering_id");

ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_rating_range_check"
  CHECK (rating >= 1 AND rating <= 5);

ALTER TABLE "engagement_reviews"
  ADD CONSTRAINT "engagement_reviews_distinct_parties_check"
  CHECK (reviewer_id <> reviewee_id);

ALTER TABLE "work_engagements"
  ADD CONSTRAINT "work_engagements_completed_timestamps_check"
  CHECK (
    status <> 'completed'::"WorkEngagementStatus"
    OR (completed_at IS NOT NULL AND review_window_closes_at IS NOT NULL)
  );

ALTER TABLE "users" DROP COLUMN "rating_avg";
ALTER TABLE "users" DROP COLUMN "rating_count";
ALTER TABLE "service_offerings" DROP COLUMN "rating_avg";
ALTER TABLE "service_offerings" DROP COLUMN "rating_count";

REVOKE ALL ON TABLE public.engagement_reviews FROM anon, authenticated;
ALTER TABLE public.engagement_reviews ENABLE ROW LEVEL SECURITY;
