-- Marketplace redesign: WorkRequest is the unified Jobs inbox / negotiation entity.
-- JobListing / JobApplication / WorkEngagement remain as source links.

CREATE TYPE "WorkRequestSource" AS ENUM ('job_posting', 'service_request', 'direct_request');
CREATE TYPE "WorkRequestStatus" AS ENUM ('pending', 'changes_requested', 'pending_payment', 'rejected', 'withdrawn');
CREATE TYPE "WorkRequestEventType" AS ENUM ('created', 'changes_requested', 'changes_accepted', 'changes_declined', 'accepted', 'rejected', 'withdrawn', 'viewed', 'listing_closed', 'note');

CREATE TABLE "work_requests" (
    "id" UUID NOT NULL,
    "source" "WorkRequestSource" NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "client_user_id" UUID NOT NULL,
    "provider_user_id" UUID NOT NULL,
    "job_listing_id" UUID,
    "job_application_id" UUID,
    "service_offering_id" UUID,
    "work_engagement_id" UUID,
    "title" TEXT NOT NULL,
    "status" "WorkRequestStatus" NOT NULL DEFAULT 'pending',
    "terms_json" JSONB NOT NULL,
    "proposed_terms_json" JSONB,
    "agreed_terms_json" JSONB,
    "proposed_by_user_id" UUID,
    "proposal_comment" TEXT NOT NULL DEFAULT '',
    "rejection_comment" TEXT NOT NULL DEFAULT '',
    "sender_last_viewed_at" TIMESTAMP(3),
    "recipient_last_viewed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_requests_sender_recipient_check" CHECK ("sender_user_id" <> "recipient_user_id"),
    CONSTRAINT "work_requests_client_provider_check" CHECK ("client_user_id" <> "provider_user_id")
);

CREATE TABLE "work_request_events" (
    "id" UUID NOT NULL,
    "work_request_id" UUID NOT NULL,
    "type" "WorkRequestEventType" NOT NULL,
    "actor_id" UUID,
    "from_status" "WorkRequestStatus",
    "to_status" "WorkRequestStatus",
    "note" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_request_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_requests_job_application_id_key" ON "work_requests"("job_application_id");
CREATE UNIQUE INDEX "work_requests_work_engagement_id_key" ON "work_requests"("work_engagement_id");
CREATE INDEX "work_requests_sender_user_id_status_idx" ON "work_requests"("sender_user_id", "status");
CREATE INDEX "work_requests_recipient_user_id_status_idx" ON "work_requests"("recipient_user_id", "status");
CREATE INDEX "work_requests_updated_at_idx" ON "work_requests"("updated_at");
CREATE INDEX "work_requests_job_listing_id_status_idx" ON "work_requests"("job_listing_id", "status");

CREATE INDEX "work_request_events_work_request_id_created_at_idx" ON "work_request_events"("work_request_id", "created_at");

ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_provider_user_id_fkey" FOREIGN KEY ("provider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_job_listing_id_fkey" FOREIGN KEY ("job_listing_id") REFERENCES "job_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_job_application_id_fkey" FOREIGN KEY ("job_application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_work_engagement_id_fkey" FOREIGN KEY ("work_engagement_id") REFERENCES "work_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_request_events" ADD CONSTRAINT "work_request_events_work_request_id_fkey" FOREIGN KEY ("work_request_id") REFERENCES "work_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: existing job applications become job_posting work requests.
-- Sender = applicant, recipient = listing poster (who is client; applicant is
-- provider). Accepted applications land on pending_payment and keep their
-- engagement linked; the engagement status itself is left untouched so active
-- work (in_progress / delivered / completed) is preserved.
-- ---------------------------------------------------------------------------
INSERT INTO "work_requests" (
    "id",
    "source",
    "sender_user_id",
    "recipient_user_id",
    "client_user_id",
    "provider_user_id",
    "job_listing_id",
    "job_application_id",
    "work_engagement_id",
    "title",
    "status",
    "terms_json",
    "agreed_terms_json",
    "sender_last_viewed_at",
    "recipient_last_viewed_at",
    "deleted_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    'job_posting'::"WorkRequestSource",
    a."applicant_id",
    l."poster_id",
    l."poster_id",
    a."applicant_id",
    l."id",
    a."id",
    e."id",
    l."title",
    CASE a."status"
        WHEN 'submitted' THEN 'pending'
        WHEN 'under_review' THEN 'pending'
        WHEN 'rejected' THEN 'rejected'
        WHEN 'withdrawn' THEN 'withdrawn'
        WHEN 'accepted' THEN 'pending_payment'
    END::"WorkRequestStatus",
    jsonb_build_object(
        'title', l."title",
        'scope', l."description",
        'price', COALESCE(l."salary_label", ''),
        'currency', 'SAR',
        'deadlineLabel', 'Flexible',
        'notes', a."cover_letter",
        'location', l."location",
        'employmentType', l."employment_type"::text
    ),
    CASE
        WHEN a."status" = 'accepted' THEN jsonb_build_object(
            'title', l."title",
            'scope', l."description",
            'price', COALESCE(l."salary_label", ''),
            'currency', 'SAR',
            'deadlineLabel', 'Flexible',
            'notes', a."cover_letter",
            'location', l."location",
            'employmentType', l."employment_type"::text
        )
        ELSE NULL
    END,
    a."created_at",
    CASE WHEN a."status" = 'submitted' THEN NULL ELSE a."updated_at" END,
    a."deleted_at",
    a."created_at",
    a."updated_at"
FROM "job_applications" a
JOIN "job_listings" l ON l."id" = a."listing_id"
LEFT JOIN "work_engagements" e
    ON e."application_id" = a."id"
   AND e."deleted_at" IS NULL
WHERE a."applicant_id" <> l."poster_id";

-- ---------------------------------------------------------------------------
-- Backfill: engagements created outside the application flow (service requests,
-- direct requests, legacy listing engagements without an application row).
-- The client is always the requester/sender for these sources.
-- ---------------------------------------------------------------------------
INSERT INTO "work_requests" (
    "id",
    "source",
    "sender_user_id",
    "recipient_user_id",
    "client_user_id",
    "provider_user_id",
    "job_listing_id",
    "service_offering_id",
    "work_engagement_id",
    "title",
    "status",
    "terms_json",
    "agreed_terms_json",
    "sender_last_viewed_at",
    "recipient_last_viewed_at",
    "deleted_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    CASE e."source"
        WHEN 'service_request' THEN 'service_request'
        WHEN 'direct' THEN 'direct_request'
        ELSE 'job_posting'
    END::"WorkRequestSource",
    e."client_id",
    e."provider_id",
    e."client_id",
    e."provider_id",
    e."listing_id",
    e."service_offering_id",
    e."id",
    e."title",
    CASE e."status"
        WHEN 'requested' THEN 'pending'
        WHEN 'declined' THEN 'rejected'
        WHEN 'cancelled' THEN 'withdrawn'
        ELSE 'pending_payment'
    END::"WorkRequestStatus",
    jsonb_build_object(
        'title', e."title",
        'scope', COALESCE(d."notes", ''),
        'price', CASE
            WHEN d."package_price" IS NULL OR d."package_price" = 0 THEN ''
            ELSE trim(to_char(d."package_price", 'FM999999990.00'))
        END,
        'currency', COALESCE(trim(d."currency"), 'SAR'),
        'deadlineLabel', COALESCE(d."deadline_label", 'Flexible'),
        'notes', COALESCE(d."notes", ''),
        'packageName', COALESCE(d."package_name", ''),
        'addons', COALESCE(d."addons", '[]'::jsonb)
    ),
    CASE
        WHEN e."status" IN ('requested', 'declined', 'cancelled') THEN NULL
        ELSE jsonb_build_object(
            'title', e."title",
            'scope', COALESCE(d."notes", ''),
            'price', CASE
                WHEN d."package_price" IS NULL OR d."package_price" = 0 THEN ''
                ELSE trim(to_char(d."package_price", 'FM999999990.00'))
            END,
            'currency', COALESCE(trim(d."currency"), 'SAR'),
            'deadlineLabel', COALESCE(d."deadline_label", 'Flexible'),
            'notes', COALESCE(d."notes", ''),
            'packageName', COALESCE(d."package_name", ''),
            'addons', COALESCE(d."addons", '[]'::jsonb)
        )
    END,
    e."created_at",
    CASE WHEN e."status" = 'requested' THEN NULL ELSE e."updated_at" END,
    e."deleted_at",
    e."created_at",
    e."updated_at"
FROM "work_engagements" e
LEFT JOIN "engagement_details" d ON d."engagement_id" = e."id"
WHERE e."application_id" IS NULL;

-- Timeline seed so backfilled requests are not empty in the inbox UI.
INSERT INTO "work_request_events" ("id", "work_request_id", "type", "actor_id", "from_status", "to_status", "note", "created_at")
SELECT
    gen_random_uuid(),
    w."id",
    'created'::"WorkRequestEventType",
    w."sender_user_id",
    NULL,
    w."status",
    'Backfilled from existing marketplace data',
    w."created_at"
FROM "work_requests" w;

-- Supabase lockdown — same posture as the phase 3 marketplace tables:
-- all access goes through the Nest API service role.
REVOKE ALL ON TABLE public.work_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.work_request_events FROM anon, authenticated;

ALTER TABLE public.work_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_request_events ENABLE ROW LEVEL SECURITY;
