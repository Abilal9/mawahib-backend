import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const MAX_CANONICAL_SKILLS = 10;

export interface ResolvedCategory {
  id: string;
  nameEn: string;
}

export interface ResolvedSkill {
  id: string;
  nameEn: string;
  position: number;
}

export interface ResolvedTaxonomy {
  category?: ResolvedCategory;
  skills?: ResolvedSkill[];
}

type TaxonomyDb = Prisma.TransactionClient;

/** Keep the first occurrence of each id. */
export function dedupeSkillIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * Validate a canonical category and skill selection.
 * Omitted fields are left untouched. Cross-category skills are allowed.
 * A category or skill already linked to this row may stay even if inactive.
 */
export async function resolveCanonicalTaxonomy(
  db: TaxonomyDb,
  input: {
    categoryId?: string | null;
    skillIds?: string[] | null;
    existingCategoryId?: string | null;
    existingSkillIds?: readonly string[];
    requireCategory: boolean;
  },
): Promise<ResolvedTaxonomy> {
  if (input.categoryId === null) {
    throw new BadRequestException('Category cannot be cleared');
  }
  if (input.skillIds === null) {
    throw new BadRequestException('Invalid skills');
  }
  if (input.requireCategory && !input.categoryId) {
    throw new BadRequestException('Category is required');
  }

  const resolved: ResolvedTaxonomy = {};
  if (input.categoryId) {
    const category = await db.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, nameEn: true, isActive: true },
    });
    if (!category) throw new BadRequestException('Category not found');
    const alreadyLinked = category.id === input.existingCategoryId;
    if (!category.isActive && !alreadyLinked) {
      throw new BadRequestException('Category is inactive');
    }
    resolved.category = { id: category.id, nameEn: category.nameEn };
  }

  if (input.skillIds) {
    if (input.skillIds.length > MAX_CANONICAL_SKILLS) {
      throw new BadRequestException('Too many skills');
    }
    const ids = dedupeSkillIds(input.skillIds);
    if (ids.length > MAX_CANONICAL_SKILLS) {
      throw new BadRequestException('Too many skills');
    }
    const rows = await db.skill.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        nameEn: true,
        isActive: true,
        category: { select: { isActive: true } },
      },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException('Skill not found');
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const kept = new Set(input.existingSkillIds ?? []);
    resolved.skills = ids.map((id, position) => {
      const skill = byId.get(id)!;
      const alreadyLinked = kept.has(id);
      if (
        !alreadyLinked &&
        (!skill.isActive || !skill.category.isActive)
      ) {
        throw new BadRequestException('Skill is inactive');
      }
      return { id: skill.id, nameEn: skill.nameEn, position };
    });
  }

  return resolved;
}
