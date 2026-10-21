import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

/** Product bound. The catalog has 11 categories. */
export const EXPLORE_MAX_CATEGORY_FILTERS = 11;
/**
 * Abuse cap on raw category tokens before duplicate collapse.
 * A normal request is at most 11 categories.
 */
export const EXPLORE_MAX_FILTER_TOKENS = 50;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MALFORMED_TOKEN = 'invalid';
const TOO_MANY_TOKEN = 'too-many';

export type ExploreIdListParse =
  | { ok: true; ids?: string[] }
  | { ok: false; reason: 'malformed' | 'too_many' };

function pushToken(tokens: string[], value: unknown): void {
  if (typeof value !== 'string') {
    throw new Error('malformed');
  }
  for (const part of value.split(',')) {
    const token = part.trim();
    if (token) tokens.push(token);
  }
}

/**
 * Reads the raw query value. Accepts one UUID, a comma-separated list,
 * or a repeated query key that Express already parsed as an array.
 * Blank tokens drop out. Duplicates collapse. Ids are lowercased and sorted.
 */
export function parseExploreIdList(raw: unknown, max: number): ExploreIdListParse {
  if (raw == null || raw === '') return { ok: true };
  const tokens: string[] = [];
  try {
    if (Array.isArray(raw)) {
      if (raw.length === 0) return { ok: true };
      for (const item of raw) pushToken(tokens, item);
    } else if (typeof raw === 'string') {
      pushToken(tokens, raw);
    } else {
      return { ok: false, reason: 'malformed' };
    }
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (tokens.length === 0) return { ok: true };
  if (tokens.length > EXPLORE_MAX_FILTER_TOKENS) {
    return { ok: false, reason: 'too_many' };
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const id = token.toLowerCase();
    if (!UUID_V4.test(id)) return { ok: false, reason: 'malformed' };
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length > max) return { ok: false, reason: 'too_many' };
  unique.sort();
  return { ok: true, ids: unique };
}

@ValidatorConstraint({ name: 'exploreIdList', async: false })
export class ExploreIdListConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value == null) return true;
    if (!Array.isArray(value)) return false;
    if (
      value.length === 1 &&
      (value[0] === MALFORMED_TOKEN || value[0] === TOO_MANY_TOKEN)
    ) {
      return false;
    }
    return value.every((id) => typeof id === 'string' && UUID_V4.test(id));
  }

  defaultMessage(args: ValidationArguments): string {
    const tooMany =
      Array.isArray(args.value) && args.value[0] === TOO_MANY_TOKEN;
    return tooMany ? 'Too many category filters.' : 'Invalid category filter.';
  }
}

/** Query decorator. Reads `obj[key]` so implicit conversion cannot swallow a comma list. */
export function ExploreIdQuery() {
  return applyDecorators(
    Transform(({ obj, key }) => {
      const parsed = parseExploreIdList(
        obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
        EXPLORE_MAX_CATEGORY_FILTERS,
      );
      if (!parsed.ok) {
        return [parsed.reason === 'too_many' ? TOO_MANY_TOKEN : MALFORMED_TOKEN];
      }
      return parsed.ids;
    }),
    IsOptional(),
    Validate(ExploreIdListConstraint),
  );
}
