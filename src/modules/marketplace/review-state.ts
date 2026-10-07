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

export interface ReviewStateReview {
  id: string;
  rating: number;
  body: string;
  createdAt: string;
}

export interface ReviewState {
  canReview: boolean;
  myReview: ReviewStateReview | null;
  otherPartyReview: ReviewStateReview | null;
}

export interface ReviewRow {
  id: string;
  reviewerId: string;
  rating: number;
  body: string;
  createdAt: Date;
}

/**
 * Canonical eligibility for the authenticated viewer.
 * `canReview` is true only when the viewer is a party, the engagement is
 * completed, and they have not already submitted a review.
 */
export function buildReviewState(input: {
  status: string;
  viewerId: string | null | undefined;
  clientId: string;
  providerId: string;
  reviews: ReviewRow[];
}): ReviewState {
  const viewerId = input.viewerId ?? null;
  const isParty =
    !!viewerId &&
    (viewerId === input.clientId || viewerId === input.providerId);
  const mine = viewerId
    ? input.reviews.find((review) => review.reviewerId === viewerId)
    : undefined;
  const other = input.reviews.find((review) => review.reviewerId !== viewerId);

  const toDto = (review: ReviewRow | undefined): ReviewStateReview | null =>
    review
      ? {
          id: review.id,
          rating: review.rating,
          body: review.body,
          createdAt: review.createdAt.toISOString(),
        }
      : null;

  return {
    canReview: isParty && input.status === 'completed' && !mine,
    myReview: toDto(mine),
    otherPartyReview: toDto(other),
  };
}
