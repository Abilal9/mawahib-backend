import { JobListingStatus, Prisma } from '@prisma/client';
import { SaveCursor, saveKeyset } from '../../common/save-cursor';

export const SAVED_JOB_CLOSED_FAMILY: JobListingStatus[] = [
  JobListingStatus.closed,
  JobListingStatus.in_progress,
  JobListingStatus.completed,
  JobListingStatus.expired,
];

export function canSaveJob(input: {
  status: JobListingStatus;
  deletedAt: Date | null;
  posterDeletedAt: Date | null;
  posterId: string;
  viewerId: string;
  hasLiveApplication: boolean;
}): boolean {
  if (input.deletedAt || input.posterDeletedAt) return false;
  if (input.status === JobListingStatus.open) return true;
  if (
    input.status === JobListingStatus.draft ||
    input.status === JobListingStatus.archived
  ) {
    return false;
  }
  if (!SAVED_JOB_CLOSED_FAMILY.includes(input.status)) return false;
  return input.posterId === input.viewerId || input.hasLiveApplication;
}

/** Narrower than canReadListing. Draft and archived never match, even for the owner. */
export function savedJobWhere(
  viewerId: string,
  cursor: SaveCursor | null,
): Prisma.JobSaveWhereInput {
  return {
    userId: viewerId,
    job: {
      deletedAt: null,
      poster: { deletedAt: null },
      OR: [
        { status: JobListingStatus.open },
        {
          status: { in: SAVED_JOB_CLOSED_FAMILY },
          OR: [
            { posterId: viewerId },
            {
              applications: {
                some: { applicantId: viewerId, deletedAt: null },
              },
            },
          ],
        },
      ],
    },
    ...saveKeyset('jobId', cursor),
  };
}
