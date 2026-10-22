import {
  businessTodayIso,
  isIsoDate,
  type WorkRequestDeadline,
} from './work-request-terms';

/** Matches the work-request DTO cap. Larger legacy values are left unscheduled. */
export const ENGAGEMENT_SCHEDULE_DURATION_MAX = 3650;

export type EngagementScheduleDraft = {
  kind: 'deadline' | 'deadline_range';
  /** Inclusive civil date, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive civil date, YYYY-MM-DD. */
  endDate: string;
  source: 'agreed_terms' | 'resolved_duration';
};

/**
 * Postgres DATE via Prisma `@db.Date` stores the UTC calendar day.
 * UTC midnight round-trips that day on any host timezone.
 * Do not use `new Date('YYYY-MM-DD')` or a local `Date` constructor.
 */
export function utcDateFromIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoFromUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function scheduleCreateData(draft: EngagementScheduleDraft): {
  kind: EngagementScheduleDraft['kind'];
  startDate: Date;
  endDate: Date;
  source: EngagementScheduleDraft['source'];
} {
  return {
    kind: draft.kind,
    startDate: utcDateFromIso(draft.startDate),
    endDate: utcDateFromIso(draft.endDate),
    source: draft.source,
  };
}

/** Deadline = anchor + N. 2026-10-22 plus 3 days is 2026-10-25. */
export function addCalendarDays(iso: string, days: number): string {
  const date = utcDateFromIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromUtcDate(date);
}

/** Calendar months, clamped to the last day of the target month. */
export function addCalendarMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return isoFromUtcDate(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Structured `agreedTermsJson.deadline` only. Display labels are ignored. */
export function deadlineFromAgreedTerms(
  terms: unknown,
): WorkRequestDeadline | null {
  try {
    const record = asRecord(terms);
    const deadline = asRecord(record?.deadline);
    if (!deadline) return null;
    const type = deadline.type;
    if (
      type !== 'exact_date' &&
      type !== 'date_range' &&
      type !== 'duration' &&
      type !== 'flexible'
    ) {
      return null;
    }
    return deadline as unknown as WorkRequestDeadline;
  } catch {
    return null;
  }
}

/**
 * Concrete dates known at acceptance. Flexible, duration, and invalid
 * shapes return null and must not fail the acceptance transaction.
 */
export function scheduleFromAgreedDeadline(
  deadline: WorkRequestDeadline | null | undefined,
): EngagementScheduleDraft | null {
  try {
    if (!deadline) return null;
    if (deadline.type === 'exact_date') {
      const start = typeof deadline.startDate === 'string' ? deadline.startDate : '';
      if (!isIsoDate(start)) return null;
      return {
        kind: 'deadline',
        startDate: start,
        endDate: start,
        source: 'agreed_terms',
      };
    }
    if (deadline.type === 'date_range') {
      const start = typeof deadline.startDate === 'string' ? deadline.startDate : '';
      const end = typeof deadline.endDate === 'string' ? deadline.endDate : '';
      if (!isIsoDate(start) || !isIsoDate(end) || end < start) return null;
      return {
        kind: 'deadline_range',
        startDate: start,
        endDate: end,
        source: 'agreed_terms',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A duration becomes one deadline on the work-start civil day in Asia/Riyadh.
 * Weeks are 7 days. Months are calendar months, not 30-day blocks.
 */
export function scheduleFromDuration(
  deadline: WorkRequestDeadline | null | undefined,
  anchorIso: string,
): EngagementScheduleDraft | null {
  try {
    if (!deadline || deadline.type !== 'duration') return null;
    if (!isIsoDate(anchorIso)) return null;
    const value = deadline.durationValue;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > ENGAGEMENT_SCHEDULE_DURATION_MAX
    ) {
      return null;
    }
    const unit = deadline.durationUnit;
    if (unit !== 'days' && unit !== 'weeks' && unit !== 'months') return null;
    const endDate =
      unit === 'months'
        ? addCalendarMonths(anchorIso, value)
        : addCalendarDays(anchorIso, unit === 'weeks' ? value * 7 : value);
    if (!isIsoDate(endDate)) return null;
    return {
      kind: 'deadline',
      startDate: endDate,
      endDate,
      source: 'resolved_duration',
    };
  } catch {
    return null;
  }
}

/**
 * Seed and backfill share this rule: an agreed date or range wins.
 * A duration is scheduled only when a real first-start instant exists.
 */
export function resolveEngagementSchedule(input: {
  deadline: WorkRequestDeadline | null | undefined;
  startedAt?: Date | null;
}): EngagementScheduleDraft | null {
  try {
    const agreed = scheduleFromAgreedDeadline(input.deadline);
    if (agreed) return agreed;
    if (!input.startedAt) return null;
    return scheduleFromDuration(
      input.deadline,
      businessTodayIso(input.startedAt),
    );
  } catch {
    return null;
  }
}
