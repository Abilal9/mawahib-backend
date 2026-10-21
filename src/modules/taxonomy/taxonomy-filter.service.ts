import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { normalizeSkillTerm } from './normalize-skill-term';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyRepository,
} from './repositories/taxonomy.repository';
import { rankSkillSuggestions } from './taxonomy.service';

/** Same cap as the skill suggestion default. Search does not paginate skills. */
export const EXPLORE_SEARCH_SKILL_CAP = 10;
/**
 * Suggestion queries stop at 60 characters.
 * A longer Explore `q` stays text-only and does not throw.
 */
export const EXPLORE_SEARCH_SKILL_QUERY_MAX = 60;

/**
 * Category validation and internal Explore search expansion.
 * This is not a public skill filter and not the Phase C write resolver.
 */
@Injectable()
export class TaxonomyFilterService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TAXONOMY_REPOSITORY)
    private readonly taxonomy: TaxonomyRepository,
  ) {}

  async assertActiveCategories(categoryIds?: string[]): Promise<void> {
    const ids = categoryIds ?? [];
    if (ids.length === 0) return;
    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    if (categories.length !== ids.length) {
      throw new BadRequestException('Unknown or inactive category filter.');
    }
  }

  /**
   * Canonical skills that may expand one Explore query.
   * Empty, whitespace, and queries longer than 60 characters resolve nothing.
   * One- and two-character queries keep exact SkillTerm matches only.
   * Longer queries use the suggestion ranker: exact, then prefix, then contains, capped at 10.
   * A broad query such as "design" may truncate by that catalog order.
   * Text search still matches rows the cap leaves out.
   */
  async resolveSearchSkillIds(rawQ: string | undefined): Promise<string[]> {
    const query = normalizeSkillTerm(rawQ ?? '');
    if (query.length < 1 || query.length > EXPLORE_SEARCH_SKILL_QUERY_MAX) {
      return [];
    }
    const matches = await this.taxonomy.matchTerms(query);
    const eligible =
      query.length < 3
        ? matches.filter((match) => match.normalizedTerm === query)
        : matches;
    return rankSkillSuggestions(eligible, query)
      .slice(0, EXPLORE_SEARCH_SKILL_CAP)
      .map((skill) => skill.id);
  }
}
