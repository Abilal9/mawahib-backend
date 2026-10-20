import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaTaxonomyRepository } from './repositories/prisma-taxonomy.repository';
import type {
  TaxonomyCategoryRecord,
  TaxonomyTermMatch,
} from './repositories/taxonomy.repository';
import { TaxonomyController } from './taxonomy.controller';
import { presentTaxonomy, rankSkillSuggestions, TaxonomyService } from './taxonomy.service';

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

  it('ranks an exact alias before a later prefix match and hides inactive skills', async () => {
    const matchTerms = jest.fn().mockResolvedValue([
      {
        term: 'Wedding Photographer',
        normalizedTerm: 'wedding photographer',
        skill: {
          id: 'wedding',
          categoryId: 'photo-cat',
          slug: 'wedding-photography',
          nameEn: 'Wedding Photography',
          nameAr: null,
          sortOrder: 20,
          isActive: true,
          categorySortOrder: 10,
        },
      },
      {
        term: 'Photographer',
        normalizedTerm: 'photographer',
        skill: {
          id: 'photo',
          categoryId: 'photo-cat',
          slug: 'photography',
          nameEn: 'Photography',
          nameAr: null,
          sortOrder: 10,
          isActive: true,
          categorySortOrder: 10,
        },
      },
    ]);
    const service = new TaxonomyService({ listActive: jest.fn(), matchTerms });
    await expect(service.suggest(' Photographer ', '10')).resolves.toEqual([
      {
        id: 'photo',
        slug: 'photography',
        nameEn: 'Photography',
        nameAr: null,
        categoryId: 'photo-cat',
        matchedTerm: 'Photographer',
      },
      {
        id: 'wedding',
        slug: 'wedding-photography',
        nameEn: 'Wedding Photography',
        nameAr: null,
        categoryId: 'photo-cat',
        matchedTerm: 'Wedding Photographer',
      },
    ]);
    expect(matchTerms).toHaveBeenCalledWith('photographer');
  });

  it('rejects an empty suggestion query', async () => {
    const service = new TaxonomyService({
      listActive: jest.fn(),
      matchTerms: jest.fn(),
    });
    await expect(service.suggest('   ', undefined)).rejects.toThrow(
      'Query must be 1–60 characters',
    );
  });
});

describe('rankSkillSuggestions', () => {
  it('keeps one row per skill and prefers the exact term', () => {
    const ranked = rankSkillSuggestions(
      [
        {
          term: 'Photo Editing',
          normalizedTerm: 'photo editing',
          skill: {
            id: 'edit',
            categoryId: 'photo',
            slug: 'photo-editing',
            nameEn: 'Photo Editing',
            nameAr: null,
            sortOrder: 30,
            isActive: true,
            categorySortOrder: 10,
          },
        },
        {
          term: 'Photography',
          normalizedTerm: 'photography',
          skill: {
            id: 'photo',
            categoryId: 'photo',
            slug: 'photography',
            nameEn: 'Photography',
            nameAr: null,
            sortOrder: 40,
            isActive: true,
            categorySortOrder: 10,
          },
        },
        {
          term: 'Photographer',
          normalizedTerm: 'photographer',
          skill: {
            id: 'photo',
            categoryId: 'photo',
            slug: 'photography',
            nameEn: 'Photography',
            nameAr: null,
            sortOrder: 40,
            isActive: true,
            categorySortOrder: 10,
          },
        },
      ],
      'photographer',
    );
    expect(ranked.map((row) => row.matchedTerm)).toEqual(['Photographer']);
    expect(new Set(ranked.map((row) => row.id)).size).toBe(ranked.length);
  });

  it('returns one skill when its canonical name and several aliases all match', () => {
    const skill = {
      id: 'voice',
      categoryId: 'audio',
      slug: 'voice-over',
      nameEn: 'Voice Over',
      nameAr: null,
      sortOrder: 10,
      isActive: true,
      categorySortOrder: 50,
    };
    const ranked = rankSkillSuggestions(
      [
        { term: 'Voiceover', normalizedTerm: 'voiceover', skill },
        { term: 'Voice-over', normalizedTerm: 'voice-over', skill },
        { term: 'Voice Over', normalizedTerm: 'voice over', skill },
      ],
      'voice',
    );
    expect(ranked).toEqual([
      {
        id: 'voice',
        slug: 'voice-over',
        nameEn: 'Voice Over',
        nameAr: null,
        categoryId: 'audio',
        matchedTerm: 'Voice Over',
      },
    ]);
  });

  it('keeps Photography and Photo Editing as two skills for a shared prefix', () => {
    const ranked = rankSkillSuggestions(
      [
        {
          term: 'Photographer',
          normalizedTerm: 'photographer',
          skill: {
            id: 'photo',
            categoryId: 'photo',
            slug: 'photography',
            nameEn: 'Photography',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
            categorySortOrder: 10,
          },
        },
        {
          term: 'Photography',
          normalizedTerm: 'photography',
          skill: {
            id: 'photo',
            categoryId: 'photo',
            slug: 'photography',
            nameEn: 'Photography',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
            categorySortOrder: 10,
          },
        },
        {
          term: 'Photo Editor',
          normalizedTerm: 'photo editor',
          skill: {
            id: 'edit',
            categoryId: 'photo',
            slug: 'photo-editing',
            nameEn: 'Photo Editing',
            nameAr: null,
            sortOrder: 100,
            isActive: true,
            categorySortOrder: 10,
          },
        },
        {
          term: 'Photo Editing',
          normalizedTerm: 'photo editing',
          skill: {
            id: 'edit',
            categoryId: 'photo',
            slug: 'photo-editing',
            nameEn: 'Photo Editing',
            nameAr: null,
            sortOrder: 100,
            isActive: true,
            categorySortOrder: 10,
          },
        },
      ],
      'photo',
    );
    expect(ranked.map((row) => [row.id, row.nameEn, row.matchedTerm])).toEqual([
      ['photo', 'Photography', 'Photography'],
      ['edit', 'Photo Editing', 'Photo Editing'],
    ]);
  });

  it('returns Photography once for the exact canonical query', () => {
    const ranked = rankSkillSuggestions(
      [
        {
          term: 'Photography',
          normalizedTerm: 'photography',
          skill: {
            id: 'photo',
            categoryId: 'photo',
            slug: 'photography',
            nameEn: 'Photography',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
            categorySortOrder: 10,
          },
        },
      ],
      'photography',
    );
    expect(ranked.map((row) => row.id)).toEqual(['photo']);
  });

  it('ranks an exact photography name before skills that only contain it', () => {
    const skill = (
      id: string,
      name: string,
      sort: number,
    ): TaxonomyTermMatch['skill'] => ({
      id,
      categoryId: 'photo',
      slug: id,
      nameEn: name,
      nameAr: null,
      sortOrder: sort,
      isActive: true,
      categorySortOrder: 10,
    });
    const term = (name: string, sort: number): TaxonomyTermMatch => ({
      term: name,
      normalizedTerm: name.toLowerCase(),
      skill: skill(name.toLowerCase().replace(/ /g, '-'), name, sort),
    });
    const matches = [
      term('Wedding Photography', 20),
      term('Event Photography', 30),
      term('Photography', 10),
      term('Photographer', 10),
    ];
    matches[3] = {
      term: 'Photographer',
      normalizedTerm: 'photographer',
      skill: matches[2].skill,
    };
    const ranked = rankSkillSuggestions(matches, 'photography');
    const again = rankSkillSuggestions(matches, 'photography');
    expect(ranked.map((row) => row.nameEn)).toEqual([
      'Photography',
      'Wedding Photography',
      'Event Photography',
    ]);
    expect(ranked.map((row) => row.id)).toEqual(again.map((row) => row.id));
    expect(new Set(ranked.map((row) => row.id)).size).toBe(ranked.length);
  });

  it('keeps two-character queries on prefix matches inside ranking', () => {
    const ranked = rankSkillSuggestions(
      [
        {
          term: 'UI Design',
          normalizedTerm: 'ui design',
          skill: {
            id: 'ui-design',
            categoryId: 'design',
            slug: 'ui-design',
            nameEn: 'UI Design',
            nameAr: null,
            sortOrder: 10,
            isActive: true,
            categorySortOrder: 30,
          },
        },
        {
          term: 'Guide',
          normalizedTerm: 'guide',
          skill: {
            id: 'guide',
            categoryId: 'design',
            slug: 'guide',
            nameEn: 'Guide',
            nameAr: null,
            sortOrder: 20,
            isActive: true,
            categorySortOrder: 30,
          },
        },
      ],
      'ui',
    );
    expect(ranked.map((row) => row.nameEn)).toEqual(['UI Design']);
  });

  it('matches videography only because the term literally begins with video', () => {
    const videoSkill = {
      id: 'video',
      categoryId: 'video',
      slug: 'videography',
      nameEn: 'Videography',
      nameAr: null,
      sortOrder: 10,
      isActive: true,
      categorySortOrder: 20,
    };
    const ranked = rankSkillSuggestions(
      [
        {
          term: 'Videography',
          normalizedTerm: 'videography',
          skill: videoSkill,
        },
        {
          term: 'Color Grading',
          normalizedTerm: 'color grading',
          skill: {
            ...videoSkill,
            id: 'color',
            slug: 'color-grading',
            nameEn: 'Color Grading',
          },
        },
      ],
      'video',
    );
    expect(ranked.map((row) => row.nameEn)).toEqual(['Videography']);
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

  it('matches active terms by contains once the query is long enough', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaTaxonomyRepository({
      skillTerm: { findMany },
    } as never);

    await repo.matchTerms('photo');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        normalizedTerm: { contains: 'photo' },
        skill: { isActive: true, category: { isActive: true } },
      },
      orderBy: [{ normalizedTerm: 'asc' }, { id: 'asc' }],
      select: expect.any(Object),
    });
  });

  it('keeps one- and two-character queries on prefix matching', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaTaxonomyRepository({
      skillTerm: { findMany },
    } as never);

    await repo.matchTerms('ui');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          normalizedTerm: { startsWith: 'ui' },
          skill: { isActive: true, category: { isActive: true } },
        },
      }),
    );
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
