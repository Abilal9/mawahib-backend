import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { displaySkillTerm, normalizeSkillTerm } from './normalize-skill-term';
import { OTHER_CATEGORY_ID } from './taxonomy-ids';

export const MAX_CUSTOM_CATEGORY_LENGTH = 60;
export const CUSTOM_CATEGORY_MATCHES_CATEGORY = 'CUSTOM_CATEGORY_MATCHES_CATEGORY';

export interface ActiveCategoryName {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export type CustomCategoryDecision =
  | { action: 'keep' }
  | { action: 'write'; value: string | null };

/**
 * NFC, trim, and collapse whitespace. Keep the user's capitalization.
 * Reject blank text, control characters, and more than 60 code points.
 */
export function normalizeCustomCategory(raw: string): string {
  const nfc = raw.normalize('NFC');
  if (/\p{Cc}/u.test(nfc)) {
    throw new BadRequestException('Invalid category description');
  }
  const display = displaySkillTerm(nfc);
  if (!display) {
    throw new BadRequestException('Describe this category');
  }
  if ([...display].length > MAX_CUSTOM_CATEGORY_LENGTH) {
    throw new BadRequestException('Category description is too long');
  }
  return display;
}

function categoryNameMatch(
  text: string,
  categories: readonly ActiveCategoryName[],
): ActiveCategoryName | null {
  const norm = normalizeSkillTerm(text);
  for (const category of categories) {
    const names = [category.nameEn, category.nameAr].filter(
      (name): name is string => Boolean(name),
    );
    if (names.some((name) => normalizeSkillTerm(name) === norm)) {
      return category;
    }
  }
  return null;
}

/**
 * Decide what to store for customCategory.
 * Omitted text is `undefined`. An explicit clear is `null`.
 */
export function decideCustomCategory(input: {
  resultingCategoryId: string | null;
  customCategory: string | null | undefined;
  existingCustomCategory: string | null;
  activeCategories?: readonly ActiveCategoryName[];
}): CustomCategoryDecision {
  const isOther = input.resultingCategoryId === OTHER_CATEGORY_ID;
  const raw = input.customCategory;

  if (typeof raw === 'string') {
    const text = normalizeCustomCategory(raw);
    if (!isOther) {
      throw new BadRequestException(
        'Custom category is only allowed for Other',
      );
    }
    const match = categoryNameMatch(text, input.activeCategories ?? []);
    if (match) {
      throw new BadRequestException({
        message: `Choose ${match.nameEn} instead of describing it as Other`,
        code: CUSTOM_CATEGORY_MATCHES_CATEGORY,
        categoryId: match.id,
        nameEn: match.nameEn,
      });
    }
    return { action: 'write', value: text };
  }

  if (raw === null) {
    if (isOther) throw new BadRequestException('Describe this category');
    return { action: 'write', value: null };
  }

  if (isOther) {
    if (!input.existingCustomCategory) {
      throw new BadRequestException('Describe this category');
    }
    return { action: 'keep' };
  }

  if (input.existingCustomCategory != null) {
    return { action: 'write', value: null };
  }
  return { action: 'keep' };
}

export async function resolveCustomCategory(
  db: Prisma.TransactionClient,
  input: {
    resultingCategoryId: string | null;
    customCategory: string | null | undefined;
    existingCustomCategory: string | null;
  },
): Promise<CustomCategoryDecision> {
  let activeCategories: ActiveCategoryName[] | undefined;
  if (
    typeof input.customCategory === 'string' &&
    input.resultingCategoryId === OTHER_CATEGORY_ID
  ) {
    const text = normalizeCustomCategory(input.customCategory);
    if (text) {
      activeCategories = await db.category.findMany({
        where: { isActive: true },
        select: { id: true, nameEn: true, nameAr: true },
      });
    }
  }
  return decideCustomCategory({ ...input, activeCategories });
}

/** Fields to write on the parent row. Undefined means leave that column alone. */
export function taxonomyColumnPatch(input: {
  category?: { id: string; nameEn: string };
  custom: CustomCategoryDecision;
  existingCustomCategory: string | null;
}): {
  categoryId?: string;
  customCategory?: string | null;
  legacyLabel?: string;
} {
  const patch: {
    categoryId?: string;
    customCategory?: string | null;
    legacyLabel?: string;
  } = {};
  if (input.custom.action === 'write') {
    patch.customCategory = input.custom.value;
  }
  if (!input.category) {
    if (input.custom.action === 'write' && input.custom.value) {
      patch.legacyLabel = input.custom.value;
    }
    return patch;
  }
  patch.categoryId = input.category.id;
  if (input.category.id === OTHER_CATEGORY_ID) {
    const text =
      input.custom.action === 'write'
        ? input.custom.value
        : input.existingCustomCategory;
    if (!text) throw new BadRequestException('Describe this category');
    patch.legacyLabel = text;
    return patch;
  }
  patch.legacyLabel = input.category.nameEn;
  return patch;
}
