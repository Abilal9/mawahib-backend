-- Phase 3 marketplace: job listings, applications, work engagements

CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'freelance', 'gig');
CREATE TYPE "JobListingStatus" AS ENUM ('draft', 'open', 'archived', 'closed', 'in_progress', 'completed', 'expired');
CREATE TYPE "JobApplicationStatus" AS ENUM ('submitted', 'under_review', 'accepted', 'rejected', 'withdrawn');
CREATE TYPE "WorkEngagementStatus" AS ENUM ('requested', 'accepted', 'declined', 'cancelled', 'pending_payment', 'payment_failed', 'in_progress', 'delivered', 'disputed', 'completed');
CREATE TYPE "WorkEngagementSource" AS ENUM ('listing_application', 'service_request', 'direct');

CREATE TABLE "job_listings" (
    "id" UUID NOT NULL,
    "poster_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "company_name" TEXT,
    "employment_type" "EmploymentType" NOT NULL,
    "location" TEXT NOT NULL,
    "salary_label" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "explore_tag" TEXT,
    "status" "JobListingStatus" NOT NULL DEFAULT 'draft',
    "posted_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "cover_letter" TEXT NOT NULL DEFAULT '',
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'submitted',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_engagements" (
    "id" UUID NOT NULL,
    "listing_id" UUID,
    "application_id" UUID,
    "service_offering_id" UUID,
    "client_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "WorkEngagementStatus" NOT NULL,
    "source" "WorkEngagementSource" NOT NULL,
    "due_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_engagements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_engagements_client_provider_check" CHECK ("client_id" <> "provider_id")
);

CREATE TABLE "engagement_details" (
    "engagement_id" UUID NOT NULL,
    "service_name" TEXT NOT NULL DEFAULT '',
    "package_name" TEXT NOT NULL DEFAULT '',
    "package_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'SAR',
    "addons" JSONB NOT NULL DEFAULT '[]',
    "deadline_label" TEXT,
    "location_url" TEXT,
    "location_city" TEXT,
    "location_country" TEXT,
    "location_details" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "cover_letter" TEXT NOT NULL DEFAULT '',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_details_pkey" PRIMARY KEY ("engagement_id")
);

CREATE TABLE "engagement_events" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "from_status" "WorkEngagementStatus",
    "to_status" "WorkEngagementStatus" NOT NULL,
    "actor_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_listings_status_posted_at_idx" ON "job_listings"("status", "posted_at" DESC);
CREATE INDEX "job_listings_poster_id_status_idx" ON "job_listings"("poster_id", "status");
CREATE INDEX "job_listings_explore_tag_idx" ON "job_listings"("explore_tag");

CREATE UNIQUE INDEX "job_applications_listing_id_applicant_id_key" ON "job_applications"("listing_id", "applicant_id");
CREATE INDEX "job_applications_listing_id_status_idx" ON "job_applications"("listing_id", "status");
CREATE INDEX "job_applications_applicant_id_status_idx" ON "job_applications"("applicant_id", "status");

CREATE UNIQUE INDEX "work_engagements_application_id_key" ON "work_engagements"("application_id");
CREATE INDEX "work_engagements_client_id_status_idx" ON "work_engagements"("client_id", "status");
CREATE INDEX "work_engagements_provider_id_status_idx" ON "work_engagements"("provider_id", "status");
CREATE INDEX "work_engagements_listing_id_idx" ON "work_engagements"("listing_id");
CREATE INDEX "work_engagements_status_updated_at_idx" ON "work_engagements"("status", "updated_at");

CREATE INDEX "engagement_events_engagement_id_created_at_idx" ON "engagement_events"("engagement_id", "created_at");

ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_poster_id_fkey" FOREIGN KEY ("poster_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_engagements" ADD CONSTRAINT "work_engagements_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_engagements" ADD CONSTRAINT "work_engagements_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_engagements" ADD CONSTRAINT "work_engagements_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_engagements" ADD CONSTRAINT "work_engagements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_engagements" ADD CONSTRAINT "work_engagements_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engagement_details" ADD CONSTRAINT "engagement_details_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "work_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE public.job_listings FROM anon, authenticated;
REVOKE ALL ON TABLE public.job_applications FROM anon, authenticated;
REVOKE ALL ON TABLE public.work_engagements FROM anon, authenticated;
REVOKE ALL ON TABLE public.engagement_details FROM anon, authenticated;
REVOKE ALL ON TABLE public.engagement_events FROM anon, authenticated;

ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;
