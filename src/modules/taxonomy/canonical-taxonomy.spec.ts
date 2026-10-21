import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  dedupeSkillIds,
  resolveCanonicalTaxonomy,
} from './canonical-taxonomy';

const design = { id: 'design', nameEn: 'Design', isActive: true };
const inactive = { id: 'old', nameEn: 'Old', isActive: false };
const branding = {
  id: 'branding',
  nameEn: 'Branding',
  isActive: true,
  category: { isActive: true },
};
const ui = {
  id: 'ui',
  nameEn: 'UI Design',
  isActive: true,
  category: { isActive: true },
};
const afterEffects = {
  id: 'ae',
  nameEn: 'After Effects',
  isActive: true,
  category: { isActive: true },
};
const retired = {
  id: 'retired',
  nameEn: 'Retired',
  isActive: false,
  category: { isActive: true },
};

function fakeDb(
  categories = [design, inactive],
  skills = [branding, ui, afterEffects, retired],
) {
  return {
    category: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        categories.find((row) => row.id === where.id) ?? null,
      ),
    },
    skill: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        skills.filter((row) => where.id.in.includes(row.id)),
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe('canonical taxonomy selection', () => {
  it('dedupes skill ids and keeps the first order', () => {
    expect(dedupeSkillIds(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('requires a category on create and rejects a cleared category', async () => {
    const db = fakeDb();
    await expect(
      resolveCanonicalTaxonomy(db, { skillIds: [], requireCategory: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: null,
        requireCategory: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing, inactive, or newly inactive category', async () => {
    const db = fakeDb();
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: 'missing',
        requireCategory: true,
      }),
    ).rejects.toThrow('Category not found');
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: 'old',
        requireCategory: true,
      }),
    ).rejects.toThrow('Category is inactive');
  });

  it('keeps an already linked inactive category and allows cross-category skills', async () => {
    const db = fakeDb();
    const resolved = await resolveCanonicalTaxonomy(db, {
      categoryId: 'old',
      skillIds: ['ui', 'branding', 'ui', 'ae'],
      existingCategoryId: 'old',
      requireCategory: false,
    });
    expect(resolved.category).toEqual({ id: 'old', nameEn: 'Old' });
    expect(resolved.skills?.map((skill) => skill.nameEn)).toEqual([
      'UI Design',
      'Branding',
      'After Effects',
    ]);
    expect(resolved.skills?.map((skill) => skill.position)).toEqual([0, 1, 2]);
  });

  it('rejects an unknown or inactive skill and leaves the caller to roll back', async () => {
    const db = fakeDb();
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: 'design',
        skillIds: ['ui', 'missing'],
        requireCategory: true,
      }),
    ).rejects.toThrow('Skill not found');
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: 'design',
        skillIds: ['retired'],
        requireCategory: true,
      }),
    ).rejects.toThrow('Skill is inactive');
    const kept = await resolveCanonicalTaxonomy(db, {
      skillIds: ['retired'],
      existingSkillIds: ['retired'],
      requireCategory: false,
    });
    expect(kept.skills?.map((skill) => skill.id)).toEqual(['retired']);
    expect(kept.category).toBeUndefined();
  });

  it('treats an empty skill list as an explicit clear', async () => {
    const db = fakeDb();
    const resolved = await resolveCanonicalTaxonomy(db, {
      skillIds: [],
      requireCategory: false,
    });
    expect(resolved.skills).toEqual([]);
  });

  it('allows zero skills for every category and keeps omitted skills untouched', async () => {
    const db = fakeDb();
    const omitted = await resolveCanonicalTaxonomy(db, {
      categoryId: 'design',
      requireCategory: true,
    });
    expect(omitted.category).toEqual({ id: 'design', nameEn: 'Design' });
    expect(omitted.skills).toBeUndefined();
    expect(db.skill.findMany).not.toHaveBeenCalled();

    const empty = await resolveCanonicalTaxonomy(db, {
      categoryId: 'design',
      skillIds: [],
      requireCategory: true,
    });
    expect(empty.category?.nameEn).toBe('Design');
    expect(empty.skills).toEqual([]);

    const cleared = await resolveCanonicalTaxonomy(db, {
      categoryId: 'design',
      skillIds: [],
      existingSkillIds: ['branding', 'ui'],
      requireCategory: false,
    });
    expect(cleared.skills).toEqual([]);
  });

  it('preserves skills when a category changes and skill ids are omitted', async () => {
    const db = fakeDb();
    const resolved = await resolveCanonicalTaxonomy(db, {
      categoryId: 'design',
      existingSkillIds: ['branding', 'ui'],
      requireCategory: false,
    });
    expect(resolved.category?.id).toBe('design');
    expect(resolved.skills).toBeUndefined();
  });

  it('accepts ten skills and rejects eleven before and after dedupe', async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      id: `s${index}`,
      nameEn: `Skill ${index}`,
      isActive: true,
      category: { isActive: true },
    }));
    const db = fakeDb([design], many);
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: 'design',
        skillIds: many.map((skill) => skill.id),
        requireCategory: true,
      }),
    ).rejects.toThrow('Too many skills');
    const ten = await resolveCanonicalTaxonomy(db, {
      categoryId: 'design',
      skillIds: many.slice(0, 10).map((skill) => skill.id),
      requireCategory: true,
    });
    expect(ten.skills).toHaveLength(10);
    await expect(
      resolveCanonicalTaxonomy(db, {
        categoryId: 'design',
        skillIds: [...many.slice(0, 10).map((skill) => skill.id), 's0'],
        requireCategory: true,
      }),
    ).rejects.toThrow('Too many skills');
  });
});
