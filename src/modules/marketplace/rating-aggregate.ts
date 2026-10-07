export interface RatingAggregate {
  avg: number;
  count: number;
}

/**
 * Folds one new 1–5 rating into a running average:
 * `(oldAvg * oldCount + rating) / (oldCount + 1)`, rounded to the two
 * decimals stored in `users.rating_avg`.
 */
export function nextRatingAggregate(
  current: RatingAggregate,
  rating: number,
): RatingAggregate {
  const count = current.count + 1;
  const avg = (current.avg * current.count + rating) / count;
  return { avg: Math.round(avg * 100) / 100, count };
}
