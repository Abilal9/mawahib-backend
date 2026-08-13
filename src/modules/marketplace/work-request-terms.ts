import { Prisma } from '@prisma/client';

/**
 * Snapshot of what is being agreed on. Prices stay free-text labels until
 * Phase 5 introduces real payments.
 */
export interface WorkRequestTerms {
  title: string;
  scope: string;
  price: string;
  currency: string;
  deadlineLabel: string;
  notes: string;
  location?: string | null;
  employmentType?: string | null;
  packageTier?: string | null;
  packageName?: string | null;
  addons?: Array<{ id: string; title: string; price: string }>;
}

const DEFAULT_TERMS: WorkRequestTerms = {
  title: '',
  scope: '',
  price: '',
  currency: 'SAR',
  deadlineLabel: 'Flexible',
  notes: '',
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Reads a stored terms JSON blob back into a predictable shape. */
export function parseTerms(value: Prisma.JsonValue | null): WorkRequestTerms {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_TERMS };
  }
  const raw = value as Record<string, unknown>;
  const addons = Array.isArray(raw.addons)
    ? (raw.addons as unknown[]).flatMap((addon) =>
        addon && typeof addon === 'object' && !Array.isArray(addon)
          ? [
              {
                id: asString((addon as Record<string, unknown>).id),
                title: asString((addon as Record<string, unknown>).title),
                price: asString((addon as Record<string, unknown>).price),
              },
            ]
          : [],
      )
    : undefined;

  return {
    title: asString(raw.title),
    scope: asString(raw.scope),
    price: asString(raw.price),
    currency: asString(raw.currency, 'SAR'),
    deadlineLabel: asString(raw.deadlineLabel, 'Flexible'),
    notes: asString(raw.notes),
    location: typeof raw.location === 'string' ? raw.location : null,
    employmentType:
      typeof raw.employmentType === 'string' ? raw.employmentType : null,
    packageTier: typeof raw.packageTier === 'string' ? raw.packageTier : null,
    packageName: typeof raw.packageName === 'string' ? raw.packageName : null,
    ...(addons ? { addons } : {}),
  };
}

/** Applies a partial proposal on top of the current terms. */
export function mergeTerms(
  base: WorkRequestTerms,
  patch: Partial<WorkRequestTerms>,
): WorkRequestTerms {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  };
}

export function toJson(terms: WorkRequestTerms): Prisma.InputJsonValue {
  return terms as unknown as Prisma.InputJsonValue;
}
