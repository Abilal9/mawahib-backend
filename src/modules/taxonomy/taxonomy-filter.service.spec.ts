import { BadRequestException } from '@nestjs/common';
import type { TaxonomyTermMatch } from './repositories/taxonomy.repository';
import { PrismaTaxonomyRepository } from './repositories/prisma-taxonomy.repository';
import {
  EXPLORE_SEARCH_SKILL_CAP,
  TaxonomyFilterService,
} from './taxonomy-filter.service';
import { rankSkillSuggestions } from './taxonomy.service';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function term(input: {
  id: string;
  name: string;
  normalized: string;
  display?: string;
  categorySort?: number;
  skillSort?: number;
  categoryId?: string;
}): TaxonomyTermMatch {
  return {
    term: input.display ?? input.name,
    normalizedTerm: input.normalized,
    skill: {
      id: input.id,
      categoryId: input.categoryId ?? uuid(9),
      slug: input.normalized.replace(/[^a-z0-9]+/g, '-'),
      nameEn: input.name,
      nameAr: input.name,
      sortOrder: input.skillSort ?? 1,
      isActive: true,
      categorySortOrder: input.categorySort ?? 1,
    },
  };
}

describe('TaxonomyFilterService categories', () => {
  const categoryId = uuid(1);
  const prisma = {
    category: { findMany: jest.fn() },
  };
  const taxonomy = { matchTerms: jest.fn() };
  const service = new TaxonomyFilterService(prisma as never, taxonomy as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('does not query when no categories are present', async () => {
    await service.assertActiveCategories();
    await service.assertActiveCategories([]);
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('accepts active categories', async () => {
    prisma.category.findMany.mockResolvedValue([{ id: categoryId }]);
    await service.assertActiveCategories([categoryId]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { id: { in: [categoryId] }, isActive: true },
      select: { id: true },
    });
  });

  it('rejects an unknown or inactive category without echoing the id', async () => {
    prisma.category.findMany.mockResolvedValue([]);
    await expect(service.assertActiveCategories([categoryId])).rejects.toThrow(
      new BadRequestException('Unknown or inactive category filter.'),
    );
    await expect(service.assertActiveCategories([categoryId])).rejects.toThrow(
      'Unknown or inactive category filter.',
    );
  });
});

describe('resolveSearchSkillIds', () => {
  const taxonomy = { matchTerms: jest.fn() };
  const service = new TaxonomyFilterService({} as never, taxonomy as never);
  const photography = uuid(1);
  const wedding = uuid(2);
  const dj = uuid(3);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('resolves nothing for blank, short, or oversized queries without scanning', async () => {
    await expect(service.resolveSearchSkillIds(undefined)).resolves.toEqual([]);
    await expect(service.resolveSearchSkillIds('   ')).resolves.toEqual([]);
    await expect(service.resolveSearchSkillIds('a'.repeat(61))).resolves.toEqual([]);
    expect(taxonomy.matchTerms).not.toHaveBeenCalled();
  });

  it('keeps only exact terms for one- and two-character queries', async () => {
    taxonomy.matchTerms.mockResolvedValue([
      term({ id: uuid(8), name: 'Design', normalized: 'design' }),
      term({ id: dj, name: 'DJ', normalized: 'dj' }),
    ]);
    await expect(service.resolveSearchSkillIds('de')).resolves.toEqual([]);
    await expect(service.resolveSearchSkillIds('a')).resolves.toEqual([]);
    await expect(service.resolveSearchSkillIds('dj')).resolves.toEqual([dj]);
    await expect(service.resolveSearchSkillIds('%')).resolves.toEqual([]);
    await expect(service.resolveSearchSkillIds('_')).resolves.toEqual([]);
  });

  it('resolves an exact alias before contains matches and caps the list', async () => {
    const matches = [
      term({
        id: photography,
        name: 'Photography',
        normalized: 'photographer',
        display: 'photographer',
        categorySort: 1,
        skillSort: 1,
      }),
      term({
        id: wedding,
        name: 'Wedding Photography',
        normalized: 'wedding photographer',
        display: 'wedding photographer',
        categorySort: 1,
        skillSort: 2,
      }),
    ];
    taxonomy.matchTerms.mockResolvedValue(matches);
    await expect(service.resolveSearchSkillIds('photographer')).resolves.toEqual([
      photography,
      wedding,
    ]);
    expect(taxonomy.matchTerms).toHaveBeenCalledTimes(1);
  });

  it('uses the suggestion order and does not expand a specialty to its parent', async () => {
    const matches = [
      term({
        id: photography,
        name: 'Photography',
        normalized: 'photography',
        categorySort: 1,
        skillSort: 1,
      }),
      term({
        id: wedding,
        name: 'Wedding Photography',
        normalized: 'wedding photography',
        categorySort: 1,
        skillSort: 2,
      }),
    ];
    taxonomy.matchTerms.mockImplementation(async (query: string) =>
      query === 'photography' ? matches : [matches[1]],
    );
    const photographyIds = rankSkillSuggestions(matches, 'photography')
      .slice(0, EXPLORE_SEARCH_SKILL_CAP)
      .map((skill) => skill.id);
    await expect(service.resolveSearchSkillIds('photography')).resolves.toEqual(
      photographyIds,
    );
    await expect(service.resolveSearchSkillIds('wedding photography')).resolves.toEqual([
      wedding,
    ]);
  });

  it('returns one id when several terms point at the same skill', async () => {
    taxonomy.matchTerms.mockResolvedValue([
      term({ id: photography, name: 'Photography', normalized: 'photography' }),
      term({
        id: photography,
        name: 'Photography',
        normalized: 'photo',
        display: 'photo',
      }),
    ]);
    await expect(service.resolveSearchSkillIds('photo')).resolves.toEqual([photography]);
  });

  it('keeps the first ten skills in suggestion order', async () => {
    const matches = Array.from({ length: 12 }, (_, index) =>
      term({
        id: uuid(index + 1),
        name: `Design ${index}`,
        normalized: `design ${index}`,
        categorySort: 1,
        skillSort: index,
      }),
    );
    taxonomy.matchTerms.mockResolvedValue(matches);
    const ids = await service.resolveSearchSkillIds('design');
    expect(ids).toEqual(
      rankSkillSuggestions(matches, 'design')
        .slice(0, EXPLORE_SEARCH_SKILL_CAP)
        .map((skill) => skill.id),
    );
    expect(ids).toHaveLength(EXPLORE_SEARCH_SKILL_CAP);
  });
});

describe('matchTerms active taxonomy', () => {
  it('asks only for active skills in active categories', async () => {
    const findMany = jest.fn(async () => []);
    const repo = new PrismaTaxonomyRepository({
      skillTerm: { findMany },
    } as never);
    await repo.matchTerms('photo');
    await repo.matchTerms('de');
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          normalizedTerm: { contains: 'photo' },
          skill: { isActive: true, category: { isActive: true } },
        },
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          normalizedTerm: { startsWith: 'de' },
          skill: { isActive: true, category: { isActive: true } },
        },
      }),
    );
  });
});
