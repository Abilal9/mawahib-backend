export interface ReviewAggregate {
  average: number | null;
  count: number;
}

export interface ReviewSummaryPair {
  asProvider: ReviewAggregate;
  asClient: ReviewAggregate;
}

export const EMPTY_AGGREGATE: ReviewAggregate = { average: null, count: 0 };

export const EMPTY_REVIEW_SUMMARY: ReviewSummaryPair = {
  asProvider: EMPTY_AGGREGATE,
  asClient: EMPTY_AGGREGATE,
};

export function roundReviewAverage(value: number): number {
  return Math.round(value * 10) / 10;
}
