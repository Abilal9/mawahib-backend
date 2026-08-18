import { BadRequestException } from '@nestjs/common';

/** ISO 3166-1 alpha-2 — extend this map to add GCC markets later. */
export type CountryCode = 'SA' | 'AE';

/** ISO 4217 — presentation may use Dhs for AED. */
export type CurrencyCode = 'SAR' | 'AED';

export interface LocationOption {
  code: string;
  label: string;
}

export interface CountryDefinition {
  code: CountryCode;
  label: string;
  currency: CurrencyCode;
  locations: LocationOption[];
}

/**
 * Canonical MVP geo catalog. Adding QA/BH/KW/OM later = one entry here.
 */
export const COUNTRY_CATALOG: Record<CountryCode, CountryDefinition> = {
  SA: {
    code: 'SA',
    label: 'Saudi Arabia',
    currency: 'SAR',
    locations: [
      { code: 'riyadh', label: 'Riyadh' },
      { code: 'jeddah', label: 'Jeddah' },
      { code: 'makkah', label: 'Makkah' },
      { code: 'madinah', label: 'Madinah' },
      { code: 'dammam', label: 'Dammam' },
      { code: 'khobar', label: 'Khobar' },
      { code: 'dhahran', label: 'Dhahran' },
      { code: 'taif', label: 'Taif' },
      { code: 'abha', label: 'Abha' },
      { code: 'tabuk', label: 'Tabuk' },
      { code: 'jubail', label: 'Jubail' },
      { code: 'yanbu', label: 'Yanbu' },
      { code: 'buraydah', label: 'Buraydah' },
      { code: 'khamis_mushait', label: 'Khamis Mushait' },
      { code: 'hofuf', label: 'Hofuf' },
    ],
  },
  AE: {
    code: 'AE',
    label: 'United Arab Emirates',
    currency: 'AED',
    locations: [
      { code: 'abu_dhabi', label: 'Abu Dhabi' },
      { code: 'dubai', label: 'Dubai' },
      { code: 'sharjah', label: 'Sharjah' },
      { code: 'ajman', label: 'Ajman' },
      { code: 'umm_al_quwain', label: 'Umm Al Quwain' },
      { code: 'ras_al_khaimah', label: 'Ras Al Khaimah' },
      { code: 'fujairah', label: 'Fujairah' },
    ],
  },
};

export const SUPPORTED_COUNTRY_CODES = Object.keys(
  COUNTRY_CATALOG,
) as CountryCode[];

export const SUPPORTED_CURRENCIES: CurrencyCode[] = ['SAR', 'AED'];

export const DEFAULT_COUNTRY: CountryCode = 'SA';
export const DEFAULT_CURRENCY: CurrencyCode = 'SAR';

export function isCountryCode(value: unknown): value is CountryCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(COUNTRY_CATALOG, value.toUpperCase())
  );
}

export function normalizeCountryCode(value: unknown): CountryCode | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return isCountryCode(code) ? code : null;
}

export function currencyForCountry(countryCode: CountryCode): CurrencyCode {
  return COUNTRY_CATALOG[countryCode].currency;
}

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  if (typeof value !== 'string') return false;
  const code = value.trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as string[]).includes(code);
}

export function normalizeCurrencyCode(
  value: unknown,
  fallback: CurrencyCode = DEFAULT_CURRENCY,
): CurrencyCode {
  if (typeof value !== 'string') return fallback;
  const code = value.trim().toUpperCase();
  return isSupportedCurrency(code) ? code : fallback;
}

export function locationsForCountry(
  countryCode: CountryCode,
): LocationOption[] {
  return COUNTRY_CATALOG[countryCode].locations;
}

export function findLocation(
  countryCode: CountryCode,
  locationCode: string,
): LocationOption | null {
  const code = locationCode.trim().toLowerCase();
  return (
    COUNTRY_CATALOG[countryCode].locations.find((l) => l.code === code) ?? null
  );
}

export function assertValidLocationPair(
  countryCodeRaw: unknown,
  locationCodeRaw: unknown,
): { countryCode: CountryCode; locationCode: string } {
  const countryCode = normalizeCountryCode(countryCodeRaw);
  if (!countryCode) {
    throw new BadRequestException(
      `countryCode must be one of: ${SUPPORTED_COUNTRY_CODES.join(', ')}`,
    );
  }
  if (typeof locationCodeRaw !== 'string' || !locationCodeRaw.trim()) {
    throw new BadRequestException('locationCode is required');
  }
  const location = findLocation(countryCode, locationCodeRaw);
  if (!location) {
    throw new BadRequestException(
      `locationCode "${locationCodeRaw}" is not valid for ${countryCode}`,
    );
  }
  return { countryCode, locationCode: location.code };
}

/** Denormalized display labels stored alongside codes for list UIs. */
export function locationDisplayFields(
  countryCode: CountryCode,
  locationCode: string,
): {
  countryCode: CountryCode;
  locationCode: string;
  locationCountry: string;
  locationCity: string;
  defaultCurrency: CurrencyCode;
} {
  const { countryCode: cc, locationCode: lc } = assertValidLocationPair(
    countryCode,
    locationCode,
  );
  const country = COUNTRY_CATALOG[cc];
  const location = findLocation(cc, lc)!;
  return {
    countryCode: cc,
    locationCode: lc,
    locationCountry: country.label,
    locationCity: location.label,
    defaultCurrency: country.currency,
  };
}

/** Money amounts are always persisted/displayed with two decimal places. */
export function roundMoneyAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Canonical money display.
 * SAR → "SAR 500.00"
 * AED → "Dhs 500.00" (DB still stores AED)
 */
export function formatMoneyDisplay(input: {
  amount: number;
  currency: string;
}): string {
  const currency = normalizeCurrencyCode(input.currency);
  const amount = roundMoneyAmount(input.amount);
  const number = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = currency === 'AED' ? 'Dhs' : 'SAR';
  return `${prefix} ${number}`;
}
