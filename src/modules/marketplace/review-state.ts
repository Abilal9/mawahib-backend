import type { WorkEngagementStatus } from '@prisma/client';

/** Commercial files freeze once delivery is submitted, and stay frozen if the work is later cancelled. */
const LOCKED_ENGAGEMENT_STATUSES = new Set<WorkEngagementStatus>([
  'delivered',
  'disputed',
  'completed',
  'cancelled',
]);

export function attachmentsLocked(
  status: WorkEngagementStatus | null | undefined,
): boolean {
  return !!status && LOCKED_ENGAGEMENT_STATUSES.has(status);
}
