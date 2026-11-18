import {
  JobListingStatus,
  PostVisibility,
  ServiceOfferingStatus,
} from '@prisma/client';
import { discoverableUserWhere } from './discoverable-user';

/** Overview accounts: retained product accounts, including suspended ones. */
export const retainedAccountWhere = { deletedAt: null } as const;

/** Overview engagements: retained rows in every business status. */
export const retainedEngagementWhere = { deletedAt: null } as const;

/**
 * Guest and public job read path. Expired is a listing status, not a
 * separate clock check, so only `open` is public.
 */
export const publicJobWhere = {
  deletedAt: null,
  staffHiddenAt: null,
  status: JobListingStatus.open,
  poster: discoverableUserWhere,
} as const;

/** Public service read path. */
export const publicServiceWhere = {
  deletedAt: null,
  staffHiddenAt: null,
  status: ServiceOfferingStatus.published,
  user: discoverableUserWhere,
} as const;

/** Public feed read path. Connections-only posts are not included. */
export const publicPostWhere = {
  deletedAt: null,
  staffHiddenAt: null,
  visibility: PostVisibility.public,
  author: discoverableUserWhere,
} as const;

/** Current staff-hide mark on a retained job. Not a count of hide actions. */
export const staffHiddenJobWhere = {
  deletedAt: null,
  staffHiddenAt: { not: null },
} as const;

/** Current staff-hide mark on a retained service. */
export const staffHiddenServiceWhere = {
  deletedAt: null,
  staffHiddenAt: { not: null },
} as const;
