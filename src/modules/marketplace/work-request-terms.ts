import { Prisma } from '@prisma/client';
import {
  formatMoneyDisplay,
  normalizeCurrencyCode,
} from '../../common/location/geo';

/** Amount + currency. Money is structured so the UI never parses labels. */
export interface WorkRequestMoney {
  amount: number;
  currency: string;
}

export type DeadlineType =
  'exact_date' | 'date_range' | 'duration' | 'flexible';

export type DurationUnit = 'days' | 'weeks' | 'months';

export interface WorkRequestDeadline {
  type: DeadlineType;
  /** YYYY-MM-DD — the date for `exact_date`, the start for `date_range` */
  startDate?: string | null;
  /** YYYY-MM-DD — only for `date_range` */
  endDate?: string | null;
  durationValue?: number | null;
  durationUnit?: DurationUnit | null;
}

export interface WorkRequestAddon {
  id: string;
  title: string;
  money: WorkRequestMoney;
}

/**
 * Snapshot of what is being agreed on. Money and deadlines are structured;
 * display strings are derived (see `formatMoney` / `formatDeadline`).
 */
export interface WorkRequestTerms {
  title: string;
  scope: string;
  money: WorkRequestMoney | null;
  deadline: WorkRequestDeadline;
  notes: string;
  location?: string | null;
  employmentType?: string | null;
  packageTier?: string | null;
  packageName?: string | null;
  addons?: WorkRequestAddon[];
}

/** A proposal may touch money/deadline partially, so those nest as partials. */
export type WorkRequestTermsPatch = Partial<
  Omit<WorkRequestTerms, 'money' | 'deadline'>
> & {
  money?: Partial<WorkRequestMoney> | null;
  deadline?: Partial<WorkRequestDeadline>;
};

export const DEFAULT_CURRENCY = 'SAR';

export const DEADLINE_TYPES: readonly DeadlineType[] = [
  'exact_date',
  'date_range',
  'duration',
  'flexible',
];

export const DURATION_UNITS: readonly DurationUnit[] = [
  'days',
  'weeks',
  'months',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_DURATION_LABEL = /^(\d+)\s*(day|days|week|weeks|month|months)$/i;
const FIRST_NUMBER = /\d+(\.\d+)?/;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function flexibleDeadline(): WorkRequestDeadline {
  return { type: 'flexible' };
}

const DEFAULT_TERMS: WorkRequestTerms = {
  title: '',
  scope: '',
  money: null,
  deadline: { type: 'flexible' },
  notes: '',
};

export function defaultTerms(): WorkRequestTerms {
  return { ...DEFAULT_TERMS, deadline: flexibleDeadline() };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Money is stored with at most two decimals so totals never drift. */
function roundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function asCurrency(value: unknown, fallback = DEFAULT_CURRENCY): string {
  return normalizeCurrencyCode(value, fallback as 'SAR' | 'AED');
}

export function moneyOf(
  amount: number,
  currency = DEFAULT_CURRENCY,
): WorkRequestMoney {
  return { amount: roundAmount(amount), currency: asCurrency(currency) };
}

/** Pulls the first number out of a free-text label (`SAR 8,000 project` → 8000). */
export function amountFromLabel(
  label: string | null | undefined,
): number | null {
  if (typeof label !== 'string') return null;
  const match = label.replace(/,/g, '').match(FIRST_NUMBER);
  return match ? roundAmount(Number(match[0])) : null;
}

/** Legacy `{ price, currency }` labels become structured money (or nothing). */
export function moneyFromLabel(
  label: string | null | undefined,
  currency?: string | null,
): WorkRequestMoney | null {
  const amount = amountFromLabel(label);
  return amount === null ? null : moneyOf(amount, asCurrency(currency));
}

/**
 * Legacy `deadlineLabel` strings become a deadline. Only an explicit duration
 * label is understood; anything else stays flexible rather than inventing dates.
 */
export function deadlineFromLabel(
  label: string | null | undefined,
): WorkRequestDeadline {
  const match =
    typeof label === 'string'
      ? label.trim().match(LEGACY_DURATION_LABEL)
      : null;
  if (!match) return flexibleDeadline();
  const unit = `${match[2].toLowerCase().replace(/s$/, '')}s` as DurationUnit;
  return {
    type: 'duration',
    durationValue: Number(match[1]),
    durationUnit: unit,
  };
}

function parseMoney(
  value: unknown,
  fallbackCurrency = DEFAULT_CURRENCY,
): WorkRequestMoney | null {
  if (!isRecord(value)) return null;
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) return null;
  return moneyOf(amount, asCurrency(value.currency, fallbackCurrency));
}

function asIsoDate(value: unknown): string | null {
  const raw = asString(value).trim();
  return isIsoDate(raw) ? raw : null;
}

function asDurationValue(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
}

function asDurationUnit(value: unknown): DurationUnit | null {
  const raw = asString(value).trim().toLowerCase();
  return (DURATION_UNITS as readonly string[]).includes(raw)
    ? (raw as DurationUnit)
    : null;
}

/** Keeps only the fields the deadline type actually uses. */
export function normalizeDeadline(
  deadline: Partial<WorkRequestDeadline>,
): WorkRequestDeadline {
  switch (deadline.type) {
    case 'exact_date':
      return { type: 'exact_date', startDate: asIsoDate(deadline.startDate) };
    case 'date_range':
      return {
        type: 'date_range',
        startDate: asIsoDate(deadline.startDate),
        endDate: asIsoDate(deadline.endDate),
      };
    case 'duration':
      return {
        type: 'duration',
        durationValue: asDurationValue(deadline.durationValue),
        durationUnit: asDurationUnit(deadline.durationUnit),
      };
    default:
      return flexibleDeadline();
  }
}

function parseDeadline(value: unknown): WorkRequestDeadline | null {
  if (!isRecord(value)) return null;
  const type = asString(value.type);
  if (!(DEADLINE_TYPES as readonly string[]).includes(type)) return null;
  return normalizeDeadline({
    type: type as DeadlineType,
    startDate: asString(value.startDate) || null,
    endDate: asString(value.endDate) || null,
    durationValue:
      value.durationValue === null || value.durationValue === undefined
        ? null
        : Number(value.durationValue),
    durationUnit: asString(value.durationUnit) as DurationUnit,
  });
}

function parseAddons(
  value: unknown,
  fallbackCurrency: string,
): WorkRequestAddon[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((addon) => {
    if (!isRecord(addon)) return [];
    const structured = parseMoney(addon.money, fallbackCurrency);
    const legacy = moneyFromLabel(asString(addon.price), fallbackCurrency);
    return [
      {
        id: asString(addon.id),
        title: asString(addon.title),
        money: structured ?? legacy ?? moneyOf(0, fallbackCurrency),
      },
    ];
  });
}

/**
 * Reads a stored terms blob back into a predictable shape. Accepts both the
 * structured shape and the legacy `{ price, currency, deadlineLabel }` one, so
 * rows written before the structured migration keep rendering.
 */
export function parseTerms(value: Prisma.JsonValue | null): WorkRequestTerms {
  if (!isRecord(value)) return defaultTerms();
  const raw = value;
  const currency = asCurrency(raw.currency);
  const parsedMoney =
    parseMoney(raw.money, currency) ??
    moneyFromLabel(asString(raw.price), currency);
  const addons = parseAddons(raw.addons, parsedMoney?.currency ?? currency);

  return {
    title: asString(raw.title),
    scope: asString(raw.scope),
    money: parsedMoney,
    deadline:
      parseDeadline(raw.deadline) ??
      deadlineFromLabel(asString(raw.deadlineLabel)),
    notes: asString(raw.notes),
    location: typeof raw.location === 'string' ? raw.location : null,
    employmentType:
      typeof raw.employmentType === 'string' ? raw.employmentType : null,
    packageTier: typeof raw.packageTier === 'string' ? raw.packageTier : null,
    packageName: typeof raw.packageName === 'string' ? raw.packageName : null,
    ...(addons ? { addons } : {}),
  };
}

function mergeMoney(
  base: WorkRequestMoney | null,
  patch: Partial<WorkRequestMoney> | null | undefined,
): WorkRequestMoney | null {
  if (patch === undefined) return base;
  if (patch === null) return null;
  const amount = Number.isFinite(Number(patch.amount))
    ? Number(patch.amount)
    : base?.amount;
  if (amount === undefined) return null;
  // Currency is frozen on the commercial work request. Amount may change;
  // currency cannot be switched via negotiation (no FX; future explicit
  // "change currency" flow only).
  const currency = base?.currency
    ? asCurrency(base.currency)
    : asCurrency(patch.currency);
  return moneyOf(amount, currency);
}

function mergeDeadline(
  base: WorkRequestDeadline,
  patch: Partial<WorkRequestDeadline> | undefined,
): WorkRequestDeadline {
  if (!patch) return base;
  // A new type replaces the deadline outright; same-type patches merge fields.
  if (patch.type && patch.type !== base.type) return normalizeDeadline(patch);
  return normalizeDeadline({
    ...base,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
    type: base.type,
  });
}

/** Applies a partial proposal on top of the current terms. */
export function mergeTerms(
  base: WorkRequestTerms,
  patch: WorkRequestTermsPatch,
): WorkRequestTerms {
  const { money: moneyPatch, deadline: deadlinePatch, ...rest } = patch;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    ),
    money: mergeMoney(base.money, moneyPatch),
    deadline: mergeDeadline(base.deadline, deadlinePatch),
  };
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Cross-field deadline checks shared by the DTO validator and the service.
 * Returns human-readable problems; an empty array means valid.
 */
export function validateDeadline(
  deadline: Partial<WorkRequestDeadline> | null | undefined,
): string[] {
  if (!deadline || typeof deadline !== 'object') {
    return ['deadline must be an object'];
  }
  const type = deadline.type;
  if (!type || !(DEADLINE_TYPES as readonly string[]).includes(type)) {
    return [`deadline.type must be one of ${DEADLINE_TYPES.join(', ')}`];
  }

  const errors: string[] = [];
  const start = asString(deadline.startDate);
  const end = asString(deadline.endDate);

  if (type === 'exact_date') {
    if (!isIsoDate(start)) errors.push('deadline.startDate must be YYYY-MM-DD');
  }
  if (type === 'date_range') {
    if (!isIsoDate(start)) errors.push('deadline.startDate must be YYYY-MM-DD');
    if (!isIsoDate(end)) errors.push('deadline.endDate must be YYYY-MM-DD');
    if (isIsoDate(start) && isIsoDate(end) && end < start) {
      errors.push('deadline.endDate must not be before deadline.startDate');
    }
  }
  if (type === 'duration') {
    const value = Number(deadline.durationValue);
    if (!Number.isInteger(value) || value < 1) {
      errors.push('deadline.durationValue must be a positive integer');
    }
    if (!asDurationUnit(deadline.durationUnit)) {
      errors.push(
        `deadline.durationUnit must be one of ${DURATION_UNITS.join(', ')}`,
      );
    }
  }
  return errors;
}

/** `SAR 3,500.00` / `Dhs 500.00` — presentation prefixes; DB stores ISO codes. */
export function formatMoney(money: WorkRequestMoney | null): string {
  if (!money) return '';
  return formatMoneyDisplay({
    amount: money.amount,
    currency: money.currency,
  });
}

/**
 * Canonical total: package/base (`money`) + sum of selected add-ons.
 * `money` must never already include add-on amounts.
 *
 * Phase 5 chargeable amount MUST use this (or `engagementChargeableTotal`),
 * never `EngagementDetail.packagePrice` alone when add-ons exist.
 */
export function termsTotal(
  terms: Pick<WorkRequestTerms, 'money' | 'addons'>,
): WorkRequestMoney | null {
  const addons = terms.addons ?? [];
  if (!terms.money && addons.length === 0) return null;
  const currency = terms.money?.currency ?? DEFAULT_CURRENCY;
  const total = addons.reduce(
    (sum, addon) => sum + (Number(addon.money?.amount) || 0),
    terms.money?.amount ?? 0,
  );
  return { amount: Math.round(total * 100) / 100, currency };
}

/**
 * Chargeable total from an accepted engagement detail snapshot.
 * `packagePrice` is package/base only; add-ons live in `addons` JSON.
 */
export function engagementChargeableTotal(detail: {
  packagePrice: unknown;
  currency?: string | null;
  addons?: unknown;
}): WorkRequestMoney {
  const base = Number(detail.packagePrice);
  const currency = asCurrency(detail.currency);
  const rawAddons = Array.isArray(detail.addons) ? detail.addons : [];
  const addons: WorkRequestAddon[] = rawAddons.map((raw, index) => {
    const row = isRecord(raw) ? raw : {};
    const money =
      parseMoney(row.money, currency) ??
      moneyFromLabel(asString(row.price), currency) ??
      moneyOf(0, currency);
    return {
      id: typeof row.id === 'string' ? row.id : `addon-${index}`,
      title: typeof row.title === 'string' ? row.title : 'Add-on',
      money,
    };
  });
  return (
    termsTotal({
      money: Number.isFinite(base)
        ? { amount: roundAmount(base), currency }
        : null,
      addons,
    }) ?? moneyOf(0, currency)
  );
}

function formatIsoDate(value: string, withYear: boolean): string {
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const label = `${MONTH_NAMES[month - 1]} ${day}`;
  return withYear ? `${label}, ${year}` : label;
}

/** `May 9, 2027` | `May 6 – May 9` | `3 days` | `Flexible` */
export function formatDeadline(
  deadline: WorkRequestDeadline | null | undefined,
): string {
  if (!deadline) return 'Flexible';
  switch (deadline.type) {
    case 'exact_date': {
      const start = asString(deadline.startDate);
      return isIsoDate(start) ? formatIsoDate(start, true) : 'Flexible';
    }
    case 'date_range': {
      const start = asString(deadline.startDate);
      const end = asString(deadline.endDate);
      if (!isIsoDate(start) || !isIsoDate(end)) return 'Flexible';
      const sameYear = start.slice(0, 4) === end.slice(0, 4);
      return `${formatIsoDate(start, !sameYear)} – ${formatIsoDate(end, !sameYear)}`;
    }
    case 'duration': {
      const value = Number(deadline.durationValue);
      const unit = asDurationUnit(deadline.durationUnit);
      if (!Number.isFinite(value) || value < 1 || !unit) return 'Flexible';
      return `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
    }
    default:
      return 'Flexible';
  }
}

export function toJson(terms: WorkRequestTerms): Prisma.InputJsonValue {
  return terms as unknown as Prisma.InputJsonValue;
}

/** Event payload for a proposal: both sides of the change stay auditable. */
export function toTermsChangePayload(
  previousTerms: WorkRequestTerms,
  proposedTerms: WorkRequestTerms,
): Prisma.InputJsonValue {
  return { previousTerms, proposedTerms } as unknown as Prisma.InputJsonValue;
}
