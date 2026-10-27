import type { WorkEngagementStatus } from '@prisma/client';

/** Commercial files freeze once delivery is submitted, including later states. */
const LOCKED_ENGAGEMENT_STATUSES = new Set<WorkEngagementStatus>([
  'delivered',
  'disputed',
  'completed',
]);

export function attachmentsLocked(
  status: WorkEngagementStatus | null | undefined,
): boolean {
  return !!status && LOCKED_ENGAGEMENT_STATUSES.has(status);
}
