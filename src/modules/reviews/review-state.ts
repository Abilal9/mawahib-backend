export interface ReviewStateMedia {
  id: string;
  mediaAssetId: string;
  mimeType: string;
}

export interface ReviewStateReview {
  id: string;
  rating: number;
  body: string;
  createdAt: string;
  media: ReviewStateMedia[];
}

export interface ReviewState {
  eligible: boolean;
  canSubmit: boolean;
  windowClosesAt: string | null;
  /** True when an existing review on this engagement is public. */
  published: boolean;
  myReview: ReviewStateReview | null;
  /** Present only when the counterpart review itself is public. */
  counterpartReview?: ReviewStateReview;
}

export interface ReviewStateRow {
  id: string;
  reviewerId: string;
  rating: number;
  body: string;
  createdAt: Date;
  media?: Array<{
    id: string;
    mediaAssetId: string;
    mediaAsset?: { mimeType: string } | null;
  }>;
}

export function isReviewPublic(input: {
  asOf: Date;
  reviewWindowClosesAt: Date | null;
  deletedAt: Date | null;
  counterpartExists: boolean;
}): boolean {
  if (input.deletedAt) return false;
  if (!input.reviewWindowClosesAt) return false;
  return (
    input.counterpartExists || input.asOf >= input.reviewWindowClosesAt
  );
}

/**
 * One review-state result for engagement, work-request, and messaging DTOs.
 * A hidden counterpart review is omitted entirely. `published` is false while
 * the other party's review is still inside an open window, including when
 * the viewer has not submitted.
 */
export function buildReviewState(input: {
  status: string;
  deletedAt?: Date | null;
  viewerId: string | null | undefined;
  clientId: string;
  providerId: string;
  completedAt?: Date | null;
  reviewWindowClosesAt?: Date | null;
  asOf: Date;
  reviews: ReviewStateRow[];
}): ReviewState {
  const viewerId = input.viewerId ?? null;
  const isParty =
    !!viewerId &&
    (viewerId === input.clientId || viewerId === input.providerId);
  if (!isParty) {
    return {
      eligible: false,
      canSubmit: false,
      windowClosesAt: null,
      published: false,
      myReview: null,
    };
  }
  const deletedAt = input.deletedAt ?? null;
  const closesAt = input.reviewWindowClosesAt ?? null;
  const eligible =
    isParty &&
    !deletedAt &&
    input.status === 'completed' &&
    !!input.completedAt &&
    !!closesAt;
  const mine = viewerId
    ? input.reviews.find((review) => review.reviewerId === viewerId)
    : undefined;
  const other = input.reviews.find((review) => review.reviewerId !== viewerId);
  const otherIsParticipant =
    !!other &&
    (other.reviewerId === input.clientId ||
      other.reviewerId === input.providerId);
  const counterpartExists = !!mine && !!other && otherIsParticipant;
  const windowClosed = !!closesAt && input.asOf >= closesAt;
  const minePublic =
    !!mine &&
    isReviewPublic({
      asOf: input.asOf,
      reviewWindowClosesAt: closesAt,
      deletedAt,
      counterpartExists,
    });
  const otherPublic =
    !!other &&
    otherIsParticipant &&
    isReviewPublic({
      asOf: input.asOf,
      reviewWindowClosesAt: closesAt,
      deletedAt,
      counterpartExists: !!mine,
    });
  const canSubmit = eligible && !mine && !windowClosed;

  const toDto = (review: ReviewStateRow): ReviewStateReview => ({
    id: review.id,
    rating: review.rating,
    body: review.body,
    createdAt: review.createdAt.toISOString(),
    media: (review.media ?? []).map((item) => ({
      id: item.id,
      mediaAssetId: item.mediaAssetId,
      mimeType: item.mediaAsset?.mimeType ?? 'application/octet-stream',
    })),
  });

  const state: ReviewState = {
    eligible,
    canSubmit,
    windowClosesAt: closesAt ? closesAt.toISOString() : null,
    published: minePublic || otherPublic,
    myReview: mine && isParty ? toDto(mine) : null,
  };
  if (otherPublic && isParty) {
    state.counterpartReview = toDto(other);
  }
  return state;
}
