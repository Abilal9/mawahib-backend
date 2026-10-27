export const REVIEW_WINDOW_DAYS = 14;
export const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function reviewWindowClosesAt(completedAt: Date): Date {
  return new Date(completedAt.getTime() + REVIEW_WINDOW_MS);
}

export function normalizeReviewBody(body?: string | null): string {
  const trimmed = (body ?? '').trim();
  return trimmed.length === 0 ? '' : trimmed;
}

export function sameReviewContent(
  existing: { rating: number; body: string; mediaAssetIds: string[] },
  next: { rating: number; body: string; mediaAssetIds: string[] },
): boolean {
  if (existing.rating !== next.rating) return false;
  if (normalizeReviewBody(existing.body) !== normalizeReviewBody(next.body)) {
    return false;
  }
  const left = [...existing.mediaAssetIds].sort();
  const right = [...next.mediaAssetIds].sort();
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}
