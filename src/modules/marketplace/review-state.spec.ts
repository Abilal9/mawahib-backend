import { attachmentsLocked, buildReviewState } from './review-state';
import {
  businessTodayIso,
  validateDeadline,
} from './work-request-terms';

describe('attachmentsLocked', () => {
  it('allows edits before delivery', () => {
    expect(attachmentsLocked(null)).toBe(false);
    expect(attachmentsLocked(undefined)).toBe(false);
    expect(attachmentsLocked('pending_payment')).toBe(false);
    expect(attachmentsLocked('in_progress')).toBe(false);
  });

  it('locks at delivered and later commercial states', () => {
    expect(attachmentsLocked('delivered')).toBe(true);
    expect(attachmentsLocked('disputed')).toBe(true);
    expect(attachmentsLocked('completed')).toBe(true);
  });
});

describe('buildReviewState', () => {
  const clientId = 'client';
  const providerId = 'provider';
  const createdAt = new Date('2026-10-07T12:00:00.000Z');

  it('is false before completion', () => {
    const state = buildReviewState({
      status: 'delivered',
      viewerId: clientId,
      clientId,
      providerId,
      reviews: [],
    });
    expect(state.canReview).toBe(false);
    expect(state.myReview).toBeNull();
    expect(state.otherPartyReview).toBeNull();
  });

  it('is true for a party on a completed engagement with no review yet', () => {
    const state = buildReviewState({
      status: 'completed',
      viewerId: providerId,
      clientId,
      providerId,
      reviews: [],
    });
    expect(state.canReview).toBe(true);
  });

  it('returns my review and hides a second review', () => {
    const state = buildReviewState({
      status: 'completed',
      viewerId: clientId,
      clientId,
      providerId,
      reviews: [
        {
          id: 'r1',
          reviewerId: clientId,
          rating: 4,
          body: 'Solid work',
          createdAt,
        },
      ],
    });
    expect(state.canReview).toBe(false);
    expect(state.myReview).toEqual({
      id: 'r1',
      rating: 4,
      body: 'Solid work',
      createdAt: createdAt.toISOString(),
    });
    expect(state.otherPartyReview).toBeNull();
  });

  it('returns the other party review independently', () => {
    const state = buildReviewState({
      status: 'completed',
      viewerId: clientId,
      clientId,
      providerId,
      reviews: [
        {
          id: 'r2',
          reviewerId: providerId,
          rating: 5,
          body: 'Clear brief',
          createdAt,
        },
      ],
    });
    expect(state.canReview).toBe(true);
    expect(state.myReview).toBeNull();
    expect(state.otherPartyReview?.id).toBe('r2');
    expect(state.otherPartyReview?.rating).toBe(5);
  });

  it('lets both parties review and then blocks the viewer who already did', () => {
    const reviews = [
      {
        id: 'mine',
        reviewerId: clientId,
        rating: 3,
        body: '',
        createdAt,
      },
      {
        id: 'theirs',
        reviewerId: providerId,
        rating: 5,
        body: '',
        createdAt,
      },
    ];
    const asClient = buildReviewState({
      status: 'completed',
      viewerId: clientId,
      clientId,
      providerId,
      reviews,
    });
    const asProvider = buildReviewState({
      status: 'completed',
      viewerId: providerId,
      clientId,
      providerId,
      reviews,
    });
    expect(asClient.canReview).toBe(false);
    expect(asClient.myReview?.id).toBe('mine');
    expect(asClient.otherPartyReview?.id).toBe('theirs');
    expect(asProvider.canReview).toBe(false);
    expect(asProvider.myReview?.id).toBe('theirs');
    expect(asProvider.otherPartyReview?.id).toBe('mine');
  });

  it('does not let an outsider review', () => {
    const state = buildReviewState({
      status: 'completed',
      viewerId: 'stranger',
      clientId,
      providerId,
      reviews: [],
    });
    expect(state.canReview).toBe(false);
  });
});

function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('deadline date validation', () => {
  const today = businessTodayIso();
  const yesterday = shiftIsoDate(today, -1);
  const tomorrow = shiftIsoDate(today, 1);

  it('rejects a past calendar date', () => {
    expect(
      validateDeadline({ type: 'exact_date', startDate: yesterday }),
    ).toContain('deadline.startDate cannot be in the past');
  });

  it('accepts today and a future date as full calendar days', () => {
    expect(validateDeadline({ type: 'exact_date', startDate: today })).toEqual(
      [],
    );
    expect(
      validateDeadline({ type: 'exact_date', startDate: tomorrow }),
    ).toEqual([]);
  });
});
