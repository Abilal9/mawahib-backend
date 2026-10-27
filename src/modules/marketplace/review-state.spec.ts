import { attachmentsLocked } from './review-state';
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
