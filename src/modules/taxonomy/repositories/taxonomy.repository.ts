export const TAXONOMY_REPOSITORY = Symbol('TAXONOMY_REPOSITORY');

export interface TaxonomySkillRecord {
  id: string;
  categoryId: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface TaxonomyCategoryRecord {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  isActive: boolean;
  skills: TaxonomySkillRecord[];
}

export interface TaxonomyRepository {
  listActive(): Promise<TaxonomyCategoryRecord[]>;
}
