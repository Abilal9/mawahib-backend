export interface ReviewAggregate {
  average: number | null;
  count: number;
  /**
   * Published counts for star values 1 through 5.
   * Present on user summaries. Service summaries omit it.
   */
  stars?: [number, number, number, number, number];
}

export interface ReviewSummaryPair {
  overall: ReviewAggregate;
  asProvider: ReviewAggregate;
  asClient: ReviewAggregate;
}

export const EMPTY_AGGREGATE: ReviewAggregate = { average: null, count: 0 };

export function emptyUserAggregate(): ReviewAggregate {
  return { average: null, count: 0, stars: [0, 0, 0, 0, 0] };
}

export const EMPTY_REVIEW_SUMMARY: ReviewSummaryPair = {
  overall: emptyUserAggregate(),
  asProvider: emptyUserAggregate(),
  asClient: emptyUserAggregate(),
};

export function roundReviewAverage(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Role of the person who received the review, from the engagement parties. */
export function receivedAsRole(input: {
  reviewerId: string;
  revieweeId: string;
  clientId: string;
  providerId: string;
}): 'provider' | 'client' {
  if (
    input.providerId === input.revieweeId &&
    input.clientId === input.reviewerId
  ) {
    return 'provider';
  }
  if (
    input.clientId === input.revieweeId &&
    input.providerId === input.reviewerId
  ) {
    return 'client';
  }
  return input.clientId === input.revieweeId ? 'client' : 'provider';
}
