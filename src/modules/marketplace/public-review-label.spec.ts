import {
  JobListingStatus,
  ServiceOfferingStatus,
  WorkEngagementSource,
} from '@prisma/client';
import { publicReviewLabel } from './public-review-label';

describe('publicReviewLabel', () => {
  it('hides a direct-request title', () => {
    expect(
      publicReviewLabel({
        source: WorkEngagementSource.direct,
      }),
    ).toBe('Direct request');
  });

  it('uses a published service title and hides a draft', () => {
    expect(
      publicReviewLabel({
        source: WorkEngagementSource.service_request,
        serviceOffering: {
          title: 'Brand Photography',
          status: ServiceOfferingStatus.published,
          deletedAt: null,
        },
      }),
    ).toBe('Brand Photography');
    expect(
      publicReviewLabel({
        source: WorkEngagementSource.service_request,
        serviceOffering: {
          title: 'Unpublished retainer',
          status: ServiceOfferingStatus.draft,
          deletedAt: null,
        },
      }),
    ).toBe('Service');
  });

  it('uses an open job title and hides a closed one', () => {
    expect(
      publicReviewLabel({
        source: WorkEngagementSource.listing_application,
        listing: {
          title: 'Designer',
          status: JobListingStatus.open,
          deletedAt: null,
        },
      }),
    ).toBe('Designer');
    expect(
      publicReviewLabel({
        source: WorkEngagementSource.listing_application,
        listing: {
          title: 'Private retainer',
          status: JobListingStatus.closed,
          deletedAt: null,
        },
      }),
    ).toBe('Job');
  });
});
