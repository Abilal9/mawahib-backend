import { Prisma, PrismaClient } from '@prisma/client';
import {
  BOOTSTRAP_TAXONOMY,
  TaxonomyCatalogError,
  assertBootstrapTaxonomy,
  type TaxonomyCategorySeed,
} from '../../src/modules/taxonomy/bootstrap-taxonomy';
import {
  displaySkillTerm,
  normalizeSkillTerm,
} from '../../src/modules/taxonomy/normalize-skill-term';
import { seedId } from './ids';

interface CategoryPlan {
  id: string;
  slug: string;
  nameEn: string;
  sortOrder: number;
  isActive?: boolean;
}

interface SkillPlan {
  id: string;
  categoryId: string;
  slug: string;
  nameEn: string;
  sortOrder: number;
  isActive?: boolean;
}

interface TermPlan {
  id: string;
  skillId: string;
  term: string;
  normalizedTerm: string;
}

export interface TaxonomySeedPlan {
  categories: CategoryPlan[];
  skills: SkillPlan[];
  terms: TermPlan[];
}

export function taxonomySeedPlan(
  catalog: readonly TaxonomyCategorySeed[] = BOOTSTRAP_TAXONOMY,
): TaxonomySeedPlan {
  assertBootstrapTaxonomy(catalog);
  const categories: CategoryPlan[] = [];
  const skills: SkillPlan[] = [];
  const terms: TermPlan[] = [];

  for (const category of catalog) {
    const categoryId = seedId(`category:${category.key}`);
    categories.push({
      id: categoryId,
      slug: category.slug,
      nameEn: category.nameEn,
      sortOrder: category.sortOrder,
      ...(category.isActive === undefined
        ? {}
        : { isActive: category.isActive }),
    });

    for (const skill of category.skills) {
      const skillId = seedId(`skill:${skill.key}`);
      skills.push({
        id: skillId,
        categoryId,
        slug: skill.slug,
        nameEn: skill.nameEn,
        sortOrder: skill.sortOrder,
        ...(skill.isActive === undefined ? {} : { isActive: skill.isActive }),
      });
      terms.push({
        id: seedId(`skill-term:${skill.key}:canonical`),
        skillId,
        term: displaySkillTerm(skill.nameEn),
        normalizedTerm: normalizeSkillTerm(skill.nameEn),
      });
      for (const alias of skill.aliases ?? []) {
        terms.push({
          id: seedId(`skill-term:${skill.key}:${alias.key}`),
          skillId,
          term: displaySkillTerm(alias.term),
          normalizedTerm: normalizeSkillTerm(alias.term),
        });
      }
    }
  }

  return { categories, skills, terms };
}

function referenceUpdate<T extends { id: string; isActive?: boolean }>(
  row: T,
): Omit<T, 'id' | 'isActive'> & { isActive?: boolean } {
  const { id: _id, isActive, ...data } = row;
  return isActive === undefined ? data : { ...data, isActive };
}

/**
 * Idempotent reference-data upsert.
 * Ids come from immutable keys, so a slug or English rename keeps the row.
 * Updates do not clear nameAr or an active flag the catalog does not mention.
 * An existing term is never moved to another skill.
 * Alias rows removed from a seeded skill are deleted. Unknown skills are left
 * in place; retire them with isActive: false and the same key.
 * This does not read or write users, services, or jobs.
 */
async function writeTaxonomy(
  db: Prisma.TransactionClient,
  catalog: readonly TaxonomyCategorySeed[],
): Promise<{ categories: number; skills: number; terms: number }> {
  const plan = taxonomySeedPlan(catalog);

  for (const category of plan.categories) {
    const { id, ...data } = category;
    await db.category.upsert({
      where: { id },
      create: { ...data, id, nameAr: null, isActive: data.isActive ?? true },
      update: referenceUpdate(category),
    });
  }

  for (const skill of plan.skills) {
    const { id, ...data } = skill;
    await db.skill.upsert({
      where: { id },
      create: { ...data, id, nameAr: null, isActive: data.isActive ?? true },
      update: referenceUpdate(skill),
    });
  }

  for (const skill of plan.skills) {
    const termIds = plan.terms
      .filter((term) => term.skillId === skill.id)
      .map((term) => term.id);
    await db.skillTerm.deleteMany({
      where: { skillId: skill.id, id: { notIn: termIds } },
    });
  }

  for (const term of plan.terms) {
    const existing = await db.skillTerm.findUnique({
      where: { normalizedTerm: term.normalizedTerm },
    });
    if (existing && existing.skillId !== term.skillId) {
      throw new TaxonomyCatalogError(
        `Term "${term.term}" already belongs to a different skill`,
      );
    }
    if (existing && existing.id !== term.id) {
      throw new TaxonomyCatalogError(
        `Term "${term.term}" already exists with a different id`,
      );
    }
    await db.skillTerm.upsert({
      where: { id: term.id },
      create: term,
      update: {
        term: term.term,
        normalizedTerm: term.normalizedTerm,
      },
    });
  }

  return {
    categories: plan.categories.length,
    skills: plan.skills.length,
    terms: plan.terms.length,
  };
}

export async function seedTaxonomy(
  prisma: PrismaClient,
  catalog: readonly TaxonomyCategorySeed[] = BOOTSTRAP_TAXONOMY,
): Promise<{ categories: number; skills: number; terms: number }> {
  // The full catalog exceeds Prisma's 5s default over the remote pooler.
  return prisma.$transaction((tx) => writeTaxonomy(tx, catalog), {
    maxWait: 15_000,
    timeout: 180_000,
  });
}
