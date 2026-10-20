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

export interface TaxonomyTermMatch {
  normalizedTerm: string;
  term: string;
  skill: TaxonomySkillRecord & { categorySortOrder: number };
}

export interface TaxonomyRepository {
  listActive(): Promise<TaxonomyCategoryRecord[]>;
  /**
   * Active skills whose canonical name or alias matches the normalized query.
   * Queries of 3+ characters match anywhere in the term. Shorter queries match
   * only at the start.
   */
  matchTerms(normalizedQuery: string): Promise<TaxonomyTermMatch[]>;
}
