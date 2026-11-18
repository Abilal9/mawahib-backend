const RIYADH = 'Asia/Riyadh';

export type GrowthPeriodDays = 7 | 30;

export function parseGrowthPeriod(value: unknown): GrowthPeriodDays {
  if (value === undefined || value === null || value === '' || value === '7' || value === 7) return 7;
  if (value === '30' || value === 30) return 30;
  throw new Error('INVALID_GROWTH_PERIOD');
}

/** Inclusive Riyadh calendar days ending at `now`, including today. */
export function riyadhGrowthWindow(now: Date, days: GrowthPeriodDays): { start: Date; end: Date } {
  const today = riyadhDate(now);
  const startDate = addCalendarDays(today, -(days - 1));
  return { start: riyadhMidnight(startDate), end: now };
}

function riyadhDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addCalendarDays(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Asia/Riyadh has no daylight-saving shift, so midnight is 21:00 UTC on the previous date. */
function riyadhMidnight(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
}
