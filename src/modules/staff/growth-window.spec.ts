import { parseGrowthPeriod, riyadhGrowthWindow } from './growth-window';

describe('Riyadh growth window', () => {
  const noon = new Date('2026-11-18T09:00:00.000Z');

  it('includes today and the preceding Riyadh dates', () => {
    const week = riyadhGrowthWindow(noon, 7);
    expect(week.end.toISOString()).toBe(noon.toISOString());
    expect(week.start.toISOString()).toBe('2026-11-11T21:00:00.000Z');
    const month = riyadhGrowthWindow(noon, 30);
    expect(month.start.toISOString()).toBe('2026-10-19T21:00:00.000Z');
  });

  it('starts at Riyadh midnight on the boundary day', () => {
    const justAfterMidnight = new Date('2026-11-17T21:00:00.000Z');
    const week = riyadhGrowthWindow(justAfterMidnight, 7);
    expect(week.start.toISOString()).toBe('2026-11-11T21:00:00.000Z');
    expect(week.end.toISOString()).toBe(justAfterMidnight.toISOString());
  });

  it('accepts only the two period lengths', () => {
    expect(parseGrowthPeriod(undefined)).toBe(7);
    expect(parseGrowthPeriod('30')).toBe(30);
    expect(() => parseGrowthPeriod('14')).toThrow('INVALID_GROWTH_PERIOD');
  });
});
