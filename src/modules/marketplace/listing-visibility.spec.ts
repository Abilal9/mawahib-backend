import { JobListingStatus } from '@prisma/client';
import {
  canReadListing,
  catalogStatusIsCallerScoped,
} from './listing-visibility';

describe('listing visibility', () => {
  const base = {
    posterId: 'owner',
    viewerId: 'other',
    viewerHasApplication: false,
  };

  it('lets the owner read every status', () => {
    for (const status of Object.values(JobListingStatus)) {
      expect(
        canReadListing({
          status,
          posterId: 'owner',
          viewerId: 'owner',
          viewerHasApplication: false,
        }),
      ).toBe(true);
    }
  });

  it('lets anyone read an open listing', () => {
    expect(
      canReadListing({ ...base, status: JobListingStatus.open }),
    ).toBe(true);
  });

  it('hides drafts and archived listings from non-owners', () => {
    expect(
      canReadListing({ ...base, status: JobListingStatus.draft }),
    ).toBe(false);
    expect(
      canReadListing({ ...base, status: JobListingStatus.archived }),
    ).toBe(false);
  });

  it('lets an applicant read a closed listing and hides it from strangers', () => {
    expect(
      canReadListing({
        ...base,
        status: JobListingStatus.closed,
        viewerHasApplication: true,
      }),
    ).toBe(true);
    expect(
      canReadListing({ ...base, status: JobListingStatus.completed }),
    ).toBe(false);
    expect(
      canReadListing({ ...base, status: JobListingStatus.in_progress }),
    ).toBe(false);
    expect(
      canReadListing({ ...base, status: JobListingStatus.expired }),
    ).toBe(false);
  });

  it('scopes non-open catalog filters to the caller', () => {
    expect(catalogStatusIsCallerScoped(JobListingStatus.open)).toBe(false);
    expect(catalogStatusIsCallerScoped(JobListingStatus.draft)).toBe(true);
    expect(catalogStatusIsCallerScoped(JobListingStatus.closed)).toBe(true);
  });
});
