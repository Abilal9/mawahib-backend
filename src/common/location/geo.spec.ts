import {
  assertValidLocationPair,
  currencyForCountry,
  formatMoneyDisplay,
  locationDisplayFields,
  normalizeCurrencyCode,
  roundMoneyAmount,
} from './geo';

describe('geo catalog', () => {
  it('maps country → currency', () => {
    expect(currencyForCountry('SA')).toBe('SAR');
    expect(currencyForCountry('AE')).toBe('AED');
  });

  it('accepts valid location pairs', () => {
    expect(assertValidLocationPair('SA', 'riyadh')).toEqual({
      countryCode: 'SA',
      locationCode: 'riyadh',
    });
    expect(assertValidLocationPair('AE', 'dubai')).toEqual({
      countryCode: 'AE',
      locationCode: 'dubai',
    });
  });

  it('rejects invalid location pairs', () => {
    expect(() => assertValidLocationPair('SA', 'dubai')).toThrow(
      /not valid for SA/,
    );
    expect(() => assertValidLocationPair('AE', 'riyadh')).toThrow(
      /not valid for AE/,
    );
  });

  it('builds display fields from codes', () => {
    expect(locationDisplayFields('SA', 'riyadh')).toMatchObject({
      locationCity: 'Riyadh',
      locationCountry: 'Saudi Arabia',
      defaultCurrency: 'SAR',
    });
    expect(locationDisplayFields('AE', 'dubai')).toMatchObject({
      locationCity: 'Dubai',
      locationCountry: 'United Arab Emirates',
      defaultCurrency: 'AED',
    });
  });

  it('formats money with two decimals and presentation prefixes', () => {
    expect(formatMoneyDisplay({ amount: 500, currency: 'SAR' })).toBe(
      'SAR 500.00',
    );
    expect(formatMoneyDisplay({ amount: 500.5, currency: 'SAR' })).toBe(
      'SAR 500.50',
    );
    expect(formatMoneyDisplay({ amount: 500, currency: 'AED' })).toBe(
      'Dhs 500.00',
    );
    expect(roundMoneyAmount(500.005)).toBe(500.01);
    expect(normalizeCurrencyCode('usd')).toBe('SAR');
  });
});
