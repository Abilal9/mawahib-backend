import { JobListingStatus } from '@prisma/client';

/**
 * Statuses that must not appear in the global catalog.
 * A list filtered to one of these returns only the caller's own rows.
 */
const CALLER_SCOPED_LISTING_STATUSES: JobListingStatus[] = [
  JobListingStatus.draft,
  JobListingStatus.archived,
  JobListingStatus.closed,
  JobListingStatus.in_progress,
  JobListingStatus.completed,
  JobListingStatus.expired,
];

export function catalogStatusIsCallerScoped(
  status: JobListingStatus,
): boolean {
  return CALLER_SCOPED_LISTING_STATUSES.includes(status);
}

/**
 * One rule for list scoping and detail reads.
 * Open listings are readable by any authenticated user.
 * Draft and archived listings are owner-only.
 * Closed, in progress, completed, and expired listings are readable by the
 * owner or by anyone who has an application on that listing, including
 * withdrawn and rejected applications.
 */
export function canReadListing(input: {
  status: JobListingStatus;
  posterId: string;
  viewerId: string;
  viewerHasApplication: boolean;
}): boolean {
  if (input.posterId === input.viewerId) return true;
  if (input.status === JobListingStatus.open) return true;
  if (
    input.status === JobListingStatus.draft ||
    input.status === JobListingStatus.archived
  ) {
    return false;
  }
  return input.viewerHasApplication;
}
