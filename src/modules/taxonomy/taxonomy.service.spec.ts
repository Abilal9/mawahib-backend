import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaTaxonomyRepository } from './repositories/prisma-taxonomy.repository';
import type { TaxonomyCategoryRecord } from './repositories/taxonomy.repository';
import { TaxonomyController } from './taxonomy.controller';
import { presentTaxonomy, TaxonomyService } from './taxonomy.service';

function category(
  partial: Partial<TaxonomyCategoryRecord> &
    Pick<TaxonomyCategoryRecord, 'id' | 'slug'>,
): TaxonomyCategoryRecord {
  return {
    nameEn: partial.slug,
    nameAr: null,
    sortOrder: 0,
    isActive: true,
    skills: [],
    ...partial,
  };
}

describe('presentTaxonomy', () => {
  it('hides inactive records, keeps skills in their category, and orders stably', () => {
    const rows = [
      category({
        id: 'design',
        slug: 'design',
        nameEn: 'Design',
        sortOrder: 20,
        skills: [
          {
            id: 'ux',
            categoryId: 'design',
            slug: 'ux-design',
            nameEn: 'UX Design',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
          },
          {
            id: 'ui',
            categoryId: 'design',
            slug: 'ui-design',
            nameEn: 'UI Design',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
          },
          {
            id: 'hidden-skill',
            categoryId: 'design',
            slug: 'figma',
            nameEn: 'Figma',
            nameAr: null,
            sortOrder: 1,
            isActive: false,
          },
          {
            id: 'stray',
            categoryId: 'other',
            slug: 'stray',
            nameEn: 'Stray',
            nameAr: null,
            sortOrder: 0,
            isActive: true,
          },
        ],
      }),
      category({
        id: 'photo',
        slug: 'photography',
        nameEn: 'Photography',
        nameAr: 'تصوير',
        sortOrder: 10,
        skills: [
          {
            id: 'photography',
            categoryId: 'photo',
            slug: 'photography',
            nameEn: 'Photography',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
          },
        ],
      }),
      category({
        id: 'retired',
        slug: 'retired',
        sortOrder: 0,
        isActive: false,
        skills: [
          {
            id: 'still-there',
            categoryId: 'retired',
            slug: 'still-there',
            nameEn: 'Still There',
            nameAr: null,
            sortOrder: 0,
            isActive: true,
          },
        ],
      }),
    ];

    const result = presentTaxonomy(rows);

    expect(result.map((item) => item.slug)).toEqual(['photography', 'design']);
    expect(result[1]?.skills.map((skill) => skill.slug)).toEqual([
      'ui-design',
      'ux-design',
    ]);
    expect(JSON.stringify(result)).not.toContain('figma');
    expect(JSON.stringify(result)).not.toContain('retired');
    expect(JSON.stringify(result)).not.toContain('stray');
    expect(JSON.stringify(result)).not.toContain('Illustrator');
    expect(result[0]?.nameAr).toBe('تصوير');
    expect(result[0]?.skills[0]).toEqual({
      id: 'photography',
      slug: 'photography',
      nameEn: 'Photography',
      nameAr: null,
      sortOrder: 10,
    });
  });
});

describe('TaxonomyService', () => {
  it('returns the repository tree through one read', async () => {
    const listActive = jest.fn().mockResolvedValue([
      category({
        id: 'design',
        slug: 'design',
        nameEn: 'Design',
        sortOrder: 10,
        skills: [],
      }),
    ]);
    const service = new TaxonomyService({ listActive });

    await expect(service.list()).resolves.toEqual({
      categories: [
        {
          id: 'design',
          slug: 'design',
          nameEn: 'Design',
          nameAr: null,
          sortOrder: 10,
          skills: [],
        },
      ],
    });
    expect(listActive).toHaveBeenCalledTimes(1);
  });
});

describe('TaxonomyController', () => {
  it('requires the same authentication as the other product APIs', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TaxonomyController,
    ) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });
});

describe('PrismaTaxonomyRepository', () => {
  it('loads active categories and skills in one query without terms', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaTaxonomyRepository({
      category: { findMany },
    } as never);

    await repo.listActive();

    expect(findMany).toHaveBeenCalledTimes(1);
    const query = firstQuery(findMany);
    expect(query.where).toEqual({ isActive: true });
    expect(query.orderBy).toEqual([
      { sortOrder: 'asc' },
      { slug: 'asc' },
      { id: 'asc' },
    ]);
    expect(query.select.createdAt).toBeUndefined();
    expect(query.select.skills.where).toEqual({ isActive: true });
    expect(query.select.skills.select.terms).toBeUndefined();
    expect(query.select.skills.select.createdAt).toBeUndefined();
  });
});

function firstQuery(mock: jest.Mock): {
  where: { isActive: boolean };
  orderBy: unknown[];
  select: {
    createdAt?: boolean;
    skills: {
      where: { isActive: boolean };
      select: { terms?: boolean; createdAt?: boolean };
    };
  };
} {
  const calls: unknown[][] = mock.mock.calls as unknown[][];
  const arg: unknown = calls[0]?.[0];
  if (!arg || typeof arg !== 'object') {
    throw new Error('missing taxonomy query');
  }
  return arg as {
    where: { isActive: boolean };
    orderBy: unknown[];
    select: {
      createdAt?: boolean;
      skills: {
        where: { isActive: boolean };
        select: { terms?: boolean; createdAt?: boolean };
      };
    };
  };
}
