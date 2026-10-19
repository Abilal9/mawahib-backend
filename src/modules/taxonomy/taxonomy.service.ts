import { Inject, Injectable } from '@nestjs/common';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyCategoryRecord,
  type TaxonomyRepository,
  type TaxonomySkillRecord,
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
