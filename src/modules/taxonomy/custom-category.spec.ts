import { BadRequestException } from '@nestjs/common';
import {
  CUSTOM_CATEGORY_MATCHES_CATEGORY,
  decideCustomCategory,
  normalizeCustomCategory,
  taxonomyColumnPatch,
} from './custom-category';
import { OTHER_CATEGORY_ID } from './taxonomy-ids';

const DESIGN = '33333333-3333-4333-8333-333333333333';
const categories = [
  { id: DESIGN, nameEn: 'Design', nameAr: null },
  { id: OTHER_CATEGORY_ID, nameEn: 'Other', nameAr: null },
  { id: 'photo', nameEn: 'Photography', nameAr: 'تصوير' },
];

function message(error: unknown): string {
  if (!(error instanceof BadRequestException)) return '';
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const text = (body as { message?: string }).message;
  return Array.isArray(text) ? text.join(' ') : (text ?? '');
}

describe('custom category', () => {
  it('keeps capitalization and collapses whitespace', () => {
    expect(normalizeCustomCategory('   Live    Illustration  ')).toBe(
      'Live Illustration',
    );
  });

  it('rejects blank, control characters, and more than 60 code points', () => {
    expect(() => normalizeCustomCategory('   ')).toThrow(BadRequestException);
    expect(() => normalizeCustomCategory('Calli\u0000graphy')).toThrow(
      BadRequestException,
    );
    expect(() => normalizeCustomCategory('Live\nIllustration')).toThrow(
      'Invalid category description',
    );
    expect(() => normalizeCustomCategory('Live\tIllustration')).toThrow(
      'Invalid category description',
    );
    expect(() => normalizeCustomCategory('ق'.repeat(61))).toThrow(
      'Category description is too long',
    );
    expect(normalizeCustomCategory('ق'.repeat(60))).toHaveLength(60);
  });

  it('stores Other text and rejects a missing description', () => {
    expect(
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: '  Calligraphy ',
        existingCustomCategory: null,
        activeCategories: categories,
      }),
    ).toEqual({ action: 'write', value: 'Calligraphy' });
    expect(() =>
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: undefined,
        existingCustomCategory: null,
      }),
    ).toThrow('Describe this category');
    expect(() =>
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: null,
        existingCustomCategory: 'Calligraphy',
      }),
    ).toThrow('Describe this category');
  });

  it('rejects custom text on a normal category and clears it when omitted', () => {
    expect(() =>
      decideCustomCategory({
        resultingCategoryId: DESIGN,
        customCategory: 'Calligraphy',
        existingCustomCategory: null,
      }),
    ).toThrow('Custom category is only allowed for Other');
    expect(
      decideCustomCategory({
        resultingCategoryId: DESIGN,
        customCategory: undefined,
        existingCustomCategory: 'Calligraphy',
      }),
    ).toEqual({ action: 'write', value: null });
    expect(
      decideCustomCategory({
        resultingCategoryId: DESIGN,
        customCategory: null,
        existingCustomCategory: 'Calligraphy',
      }),
    ).toEqual({ action: 'write', value: null });
  });

  it('keeps Other text when the description is omitted', () => {
    expect(
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: undefined,
        existingCustomCategory: 'Calligraphy',
      }),
    ).toEqual({ action: 'keep' });
  });

  it('rejects an active category name and allows a skill name', () => {
    try {
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: ' photography ',
        existingCustomCategory: null,
        activeCategories: categories,
      });
      throw new Error('expected a category-name rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        categoryId: string;
      };
      expect(body.code).toBe(CUSTOM_CATEGORY_MATCHES_CATEGORY);
      expect(body.categoryId).toBe('photo');
    }
    expect(() =>
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: 'Other',
        existingCustomCategory: null,
        activeCategories: categories,
      }),
    ).toThrow(BadRequestException);
    expect(
      decideCustomCategory({
        resultingCategoryId: OTHER_CATEGORY_ID,
        customCategory: 'Branding',
        existingCustomCategory: null,
        activeCategories: categories,
      }),
    ).toEqual({ action: 'write', value: 'Branding' });
    expect(message(new BadRequestException('x'))).toBe('x');
  });

  it('mirrors the custom text for Other and the category name otherwise', () => {
    expect(
      taxonomyColumnPatch({
        category: { id: OTHER_CATEGORY_ID, nameEn: 'Other' },
        custom: { action: 'write', value: 'Calligraphy' },
        existingCustomCategory: null,
      }),
    ).toEqual({
      categoryId: OTHER_CATEGORY_ID,
      customCategory: 'Calligraphy',
      legacyLabel: 'Calligraphy',
    });
    expect(
      taxonomyColumnPatch({
        category: { id: DESIGN, nameEn: 'Design' },
        custom: { action: 'write', value: null },
        existingCustomCategory: 'Calligraphy',
      }),
    ).toEqual({
      categoryId: DESIGN,
      customCategory: null,
      legacyLabel: 'Design',
    });
    expect(
      taxonomyColumnPatch({
        custom: { action: 'write', value: 'Hand Lettering' },
        existingCustomCategory: 'Calligraphy',
      }),
    ).toEqual({
      customCategory: 'Hand Lettering',
      legacyLabel: 'Hand Lettering',
    });
    expect(
      taxonomyColumnPatch({
        custom: { action: 'keep' },
        existingCustomCategory: 'Calligraphy',
      }),
    ).toEqual({});
  });
});
