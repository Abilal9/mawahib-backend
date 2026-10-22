import {
  addCalendarDays,
  addCalendarMonths,
  deadlineFromAgreedTerms,
  isoFromUtcDate,
  resolveEngagementSchedule,
  scheduleCreateData,
  scheduleFromAgreedDeadline,
  scheduleFromDuration,
  utcDateFromIso,
} from './engagement-schedule';
import type { WorkRequestDeadline } from './work-request-terms';

describe('engagement schedule dates', () => {
  it('round-trips civil dates through UTC midnight', () => {
    for (const iso of ['2026-01-01', '2026-10-22', '2026-12-31']) {
      const stored = utcDateFromIso(iso);
      expect(stored.toISOString()).toBe(`${iso}T00:00:00.000Z`);
      expect(isoFromUtcDate(stored)).toBe(iso);
      expect(stored.getUTCFullYear()).toBe(Number(iso.slice(0, 4)));
      expect(stored.getUTCMonth()).toBe(Number(iso.slice(5, 7)) - 1);
      expect(stored.getUTCDate()).toBe(Number(iso.slice(8, 10)));
    }
  });

  it('adds days and weeks without treating a month as 30 days', () => {
    expect(addCalendarDays('2026-10-22', 3)).toBe('2026-10-25');
    expect(addCalendarDays('2026-10-22', 1)).toBe('2026-10-23');
    expect(addCalendarDays('2026-10-22', 7)).toBe('2026-10-29');
    expect(addCalendarDays('2026-12-30', 7)).toBe('2027-01-06');
  });

  it('clamps calendar months at month ends and leap days', () => {
    expect(addCalendarMonths('2026-10-22', 1)).toBe('2026-11-22');
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addCalendarMonths('2026-12-15', 2)).toBe('2027-02-15');
    expect(addCalendarMonths('2025-12-31', 1)).toBe('2026-01-31');
  });
});

describe('schedule from agreed deadlines', () => {
  const exact: WorkRequestDeadline = {
    type: 'exact_date',
    startDate: '2026-10-22',
  };
  const range: WorkRequestDeadline = {
    type: 'date_range',
    startDate: '2026-10-22',
    endDate: '2026-10-25',
  };

  it('stores an exact date as one civil day', () => {
    expect(scheduleFromAgreedDeadline(exact)).toEqual({
      kind: 'deadline',
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      source: 'agreed_terms',
    });
  });

  it('stores a date range inclusively and allows equal ends', () => {
    expect(scheduleFromAgreedDeadline(range)).toEqual({
      kind: 'deadline_range',
      startDate: '2026-10-22',
      endDate: '2026-10-25',
      source: 'agreed_terms',
    });
    expect(
      scheduleFromAgreedDeadline({
        type: 'date_range',
        startDate: '2026-10-22',
        endDate: '2026-10-22',
      }),
    ).toMatchObject({ kind: 'deadline_range', startDate: '2026-10-22' });
  });

  it('rejects an inverted range and an impossible calendar day', () => {
    expect(
      scheduleFromAgreedDeadline({
        type: 'date_range',
        startDate: '2026-10-25',
        endDate: '2026-10-22',
      }),
    ).toBeNull();
    expect(
      scheduleFromAgreedDeadline({
        type: 'exact_date',
        startDate: '2026-02-30',
      }),
    ).toBeNull();
  });

  it('creates no row for flexible, duration, null, or a display label', () => {
    expect(scheduleFromAgreedDeadline({ type: 'flexible' })).toBeNull();
    expect(
      scheduleFromAgreedDeadline({
        type: 'duration',
        durationValue: 3,
        durationUnit: 'days',
      }),
    ).toBeNull();
    expect(scheduleFromAgreedDeadline(null)).toBeNull();
    expect(
      deadlineFromAgreedTerms({ deadlineLabel: '3 days', deadline: null }),
    ).toBeNull();
  });

  it('does not rewrite the agreed terms object', () => {
    const terms = {
      title: 'Shoot',
      deadline: exact,
    };
    const before = JSON.stringify(terms);
    scheduleFromAgreedDeadline(terms.deadline);
    expect(JSON.stringify(terms)).toBe(before);
  });
});

describe('duration resolution', () => {
  it('counts the deadline as the anchor plus N, including weeks and months', () => {
    expect(
      scheduleFromDuration(
        { type: 'duration', durationValue: 3, durationUnit: 'days' },
        '2026-10-22',
      ),
    ).toEqual({
      kind: 'deadline',
      startDate: '2026-10-25',
      endDate: '2026-10-25',
      source: 'resolved_duration',
    });
    expect(
      scheduleFromDuration(
        { type: 'duration', durationValue: 2, durationUnit: 'weeks' },
        '2026-10-22',
      )?.endDate,
    ).toBe('2026-11-05');
    expect(
      scheduleFromDuration(
        { type: 'duration', durationValue: 1, durationUnit: 'months' },
        '2026-01-31',
      )?.endDate,
    ).toBe('2026-02-28');
  });

  it('skips non-integers, zero, and values above the request cap', () => {
    expect(
      scheduleFromDuration(
        { type: 'duration', durationValue: 1.5, durationUnit: 'days' },
        '2026-10-22',
      ),
    ).toBeNull();
    expect(
      scheduleFromDuration(
        { type: 'duration', durationValue: 0, durationUnit: 'days' },
        '2026-10-22',
      ),
    ).toBeNull();
    expect(
      scheduleFromDuration(
        { type: 'duration', durationValue: 3651, durationUnit: 'days' },
        '2026-10-22',
      ),
    ).toBeNull();
  });

  it('uses a first-start instant and ignores duration until then', () => {
    const deadline: WorkRequestDeadline = {
      type: 'duration',
      durationValue: 3,
      durationUnit: 'days',
    };
    expect(resolveEngagementSchedule({ deadline })).toBeNull();
    const resolved = resolveEngagementSchedule({
      deadline,
      startedAt: new Date('2026-10-22T12:00:00.000Z'),
    });
    expect(resolved?.endDate).toBe('2026-10-25');
    expect(resolved?.source).toBe('resolved_duration');
  });

  it('anchors the civil day in Asia/Riyadh across midnight', () => {
    const deadline: WorkRequestDeadline = {
      type: 'duration',
      durationValue: 3,
      durationUnit: 'days',
    };
    // 20:59:59Z is still 22 Oct in Riyadh (UTC+3). 21:30Z is 23 Oct.
    expect(
      resolveEngagementSchedule({
        deadline,
        startedAt: new Date('2026-10-22T20:59:59.000Z'),
      })?.endDate,
    ).toBe('2026-10-25');
    expect(
      resolveEngagementSchedule({
        deadline,
        startedAt: new Date('2026-10-22T21:30:00.000Z'),
      })?.endDate,
    ).toBe('2026-10-26');
  });

  it('writes Prisma dates at UTC midnight', () => {
    const data = scheduleCreateData({
      kind: 'deadline',
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      source: 'agreed_terms',
    });
    expect(data.startDate.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(data.endDate.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });
});
