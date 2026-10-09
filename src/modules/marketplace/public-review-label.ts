import {
  JobListingStatus,
  ServiceOfferingStatus,
  WorkEngagementSource,
} from '@prisma/client';

/**
 * Label safe to show on a public profile review.
 * Direct-request titles stay private. A job title is shown only while that
 * listing is still publicly open. A service uses the public offering title.
 */
export function publicReviewLabel(engagement: {
  source: WorkEngagementSource;
  listing?: {
    title: string;
    status: JobListingStatus;
    deletedAt: Date | null;
  } | null;
  serviceOffering?: {
    title: string;
    status: ServiceOfferingStatus;
    deletedAt: Date | null;
  } | null;
}): string {
  if (engagement.source === WorkEngagementSource.direct) {
    return 'Direct request';
  }
  if (engagement.source === WorkEngagementSource.service_request) {
    const offering = engagement.serviceOffering;
    if (
      offering &&
      !offering.deletedAt &&
      offering.status === ServiceOfferingStatus.published
    ) {
      const title = offering.title.trim();
      if (title) return title;
    }
    return 'Service';
  }
  if (engagement.source === WorkEngagementSource.listing_application) {
    const listing = engagement.listing;
    if (
      listing &&
      !listing.deletedAt &&
      listing.status === JobListingStatus.open
    ) {
      return listing.title;
    }
    return 'Job';
  }
  return 'Engagement';
}
