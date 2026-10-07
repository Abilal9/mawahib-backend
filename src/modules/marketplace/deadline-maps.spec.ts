import { acceptedGoogleMapsUrl } from './google-maps-url';
import { normalizeDeadline } from './work-request-terms';

describe('normalizeDeadline', () => {
  it('drops dates when the active mode is duration', () => {
    expect(
      normalizeDeadline({
        type: 'duration',
        durationValue: 7,
        durationUnit: 'days',
        startDate: '2026-10-20',
        endDate: '2026-10-25',
      }),
    ).toEqual({
      type: 'duration',
      durationValue: 7,
      durationUnit: 'days',
    });
  });

  it('drops duration fields when the active mode is an exact date', () => {
    expect(
      normalizeDeadline({
        type: 'exact_date',
        startDate: '2026-10-20',
        durationValue: 10,
        durationUnit: 'days',
      }),
    ).toEqual({
      type: 'exact_date',
      startDate: '2026-10-20',
    });
  });

  it('keeps only the range when that is the active mode', () => {
    expect(
      normalizeDeadline({
        type: 'date_range',
        startDate: '2026-10-20',
        endDate: '2026-10-25',
        durationValue: 7,
        durationUnit: 'weeks',
      }),
    ).toEqual({
      type: 'date_range',
      startDate: '2026-10-20',
      endDate: '2026-10-25',
    });
  });

  it('stores flexible with no schedule fields', () => {
    expect(
      normalizeDeadline({
        type: 'flexible',
        startDate: '2026-10-20',
        endDate: '2026-10-25',
        durationValue: 7,
        durationUnit: 'days',
      }),
    ).toEqual({ type: 'flexible' });
  });
});

describe('acceptedGoogleMapsUrl', () => {
  const short = 'https://maps.app.goo.gl/PtLByLhcorAFhiaa8';

  it('preserves a shortened Maps link exactly', () => {
    expect(acceptedGoogleMapsUrl(short)).toBe(short);
    expect(acceptedGoogleMapsUrl(`  ${short}  `)).toBe(short);
  });

  it('preserves official long Maps links', () => {
    const long = 'https://www.google.com/maps/place/Riyadh/@24.7,46.6,12z';
    const mapsHost = 'https://maps.google.com/?q=Riyadh';
    const bare = 'https://google.com/maps/search/Riyadh';
    expect(acceptedGoogleMapsUrl(long)).toBe(long);
    expect(acceptedGoogleMapsUrl(mapsHost)).toBe(mapsHost);
    expect(acceptedGoogleMapsUrl(bare)).toBe(bare);
  });

  it('rejects non-Maps sites and unsafe schemes', () => {
    expect(acceptedGoogleMapsUrl('https://example.com/test')).toBeNull();
    expect(acceptedGoogleMapsUrl('javascript:alert(1)')).toBeNull();
    expect(acceptedGoogleMapsUrl('file:///tmp/map')).toBeNull();
    expect(acceptedGoogleMapsUrl('data:text/html,hi')).toBeNull();
    expect(acceptedGoogleMapsUrl('http://maps.google.com/?q=Riyadh')).toBeNull();
    expect(acceptedGoogleMapsUrl('')).toBeNull();
    expect(acceptedGoogleMapsUrl(null)).toBeNull();
  });
});
