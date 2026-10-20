import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { normalizeSkillTerm } from './normalize-skill-term';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyCategoryRecord,
  type TaxonomyRepository,
  type TaxonomySkillRecord,
  type TaxonomyTermMatch,
} from './repositories/taxonomy.repository';

export interface TaxonomySkillDto {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
}

export interface TaxonomyCategoryDto {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  skills: TaxonomySkillDto[];
}

export interface TaxonomyResponse {
  categories: TaxonomyCategoryDto[];
}

export interface TaxonomySuggestionDto {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  categoryId: string;
  matchedTerm: string;
}

function compareTaxonomy(
  a: { sortOrder: number; slug: string; id: string },
  b: { sortOrder: number; slug: string; id: string },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function toSkill(skill: TaxonomySkillRecord): TaxonomySkillDto {
  return {
    id: skill.id,
    slug: skill.slug,
    nameEn: skill.nameEn,
    nameAr: skill.nameAr,
    sortOrder: skill.sortOrder,
  };
}

@Injectable()
export class TaxonomyService {
  constructor(
    @Inject(TAXONOMY_REPOSITORY)
    private readonly taxonomy: TaxonomyRepository,
  ) {}

  async list(): Promise<TaxonomyResponse> {
    const rows = await this.taxonomy.listActive();
    return { categories: presentTaxonomy(rows) };
  }

  async suggest(
    rawQuery: string | undefined,
    rawLimit: string | undefined,
  ): Promise<TaxonomySuggestionDto[]> {
    const query = normalizeSkillTerm(rawQuery ?? '');
    if (query.length < 1 || query.length > 60) {
      throw new BadRequestException('Query must be 1–60 characters');
    }
    let limit = 10;
    if (rawLimit != null && rawLimit !== '') {
      if (!/^\d+$/.test(rawLimit)) {
        throw new BadRequestException('Invalid limit');
      }
      limit = Number(rawLimit);
      if (limit < 1 || limit > 20) {
        throw new BadRequestException('Invalid limit');
      }
    }
    const matches = await this.taxonomy.matchTerms(query);
    return rankSkillSuggestions(matches, query).slice(0, limit);
  }
}

export function presentTaxonomy(
  rows: readonly TaxonomyCategoryRecord[],
): TaxonomyCategoryDto[] {
  return rows
    .filter((category) => category.isActive)
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      nameEn: category.nameEn,
      nameAr: category.nameAr,
      sortOrder: category.sortOrder,
      skills: category.skills
        .filter((skill) => skill.isActive && skill.categoryId === category.id)
        .map(toSkill)
        .sort(compareTaxonomy),
    }))
    .sort(compareTaxonomy);
}

/** 0 exact, 1 prefix, 2 contains. Null when the term does not match. */
function matchTier(term: string, query: string): number | null {
  if (term === query) return 0;
  if (term.startsWith(query)) return 1;
  if (query.length >= 3 && term.includes(query)) return 2;
  return null;
}

export function rankSkillSuggestions(
  matches: readonly TaxonomyTermMatch[],
  query: string,
): TaxonomySuggestionDto[] {
  const bySkill = new Map<
    string,
    TaxonomySuggestionDto & {
      tier: number;
      canonicalTerm: number;
      categorySort: number;
      skillSort: number;
    }
  >();
  for (const match of matches) {
    const tier = matchTier(match.normalizedTerm, query);
    if (tier == null) continue;
    const next = {
      id: match.skill.id,
      slug: match.skill.slug,
      nameEn: match.skill.nameEn,
      nameAr: match.skill.nameAr,
      categoryId: match.skill.categoryId,
      matchedTerm: match.term,
      tier,
      canonicalTerm:
        normalizeSkillTerm(match.skill.nameEn) === match.normalizedTerm ? 0 : 1,
      categorySort: match.skill.categorySortOrder,
      skillSort: match.skill.sortOrder,
    };
    const current = bySkill.get(match.skill.id);
    if (!current) {
      bySkill.set(match.skill.id, next);
      continue;
    }
    const better =
      next.tier < current.tier ||
      (next.tier === current.tier &&
        next.canonicalTerm < current.canonicalTerm) ||
      (next.tier === current.tier &&
        next.canonicalTerm === current.canonicalTerm &&
        next.matchedTerm < current.matchedTerm);
    if (better) bySkill.set(match.skill.id, next);
  }
  return [...bySkill.values()]
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.categorySort !== b.categorySort) return a.categorySort - b.categorySort;
      if (a.skillSort !== b.skillSort) return a.skillSort - b.skillSort;
      if (a.nameEn !== b.nameEn) return a.nameEn < b.nameEn ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map(
      ({
        tier: _tier,
        canonicalTerm: _canonicalTerm,
        categorySort: _categorySort,
        skillSort: _skillSort,
        ...dto
      }) => dto,
    );
}
