/** Explicit Phase C backfill. Not started with the API and not a migration. */

export const SAFE_JOB_CATEGORY_TAG = 'Design';

export const SAFE_JOB_SKILL_NAMES = [
  'UI Design',
  'Art Direction',
  'Branding',
  'Figma',
  'After Effects',
  'Campaign Design',
  'Design Systems',
  'Illustration',
  'Prototyping',
] as const;

const SAFE_JOB_SKILL_NAME_SET = new Set<string>(SAFE_JOB_SKILL_NAMES);

export interface BackfillJobRow {
  id: string;
  deletedAt: Date | null;
  categoryId: string | null;
  exploreTag: string | null;
  skills: string[];
  linkedSkillCount: number;
}

export interface BackfillCategoryRow {
  id: string;
  nameEn: string;
  isActive: boolean;
}

export interface BackfillSkillRow {
  id: string;
  nameEn: string;
  isActive: boolean;
  categoryActive: boolean;
}

export interface ServiceJobBackfillPlan {
  designCategoryId: string | null;
  categoryUpdates: Array<{ listingId: string; categoryId: string }>;
  skillLinks: Array<{ listingId: string; skillId: string; position: number }>;
  skippedSkillTokens: Array<{ listingId: string; token: string; reason: string }>;
  serviceCategoryUpdates: 0;
  serviceSkillLinks: 0;
}

export function planServiceJobBackfill(input: {
  jobs: readonly BackfillJobRow[];
  categories: readonly BackfillCategoryRow[];
  skills: readonly BackfillSkillRow[];
}): ServiceJobBackfillPlan {
  const design = input.categories.filter(
    (category) => category.nameEn === 'Design' && category.isActive,
  );
  const designCategoryId = design.length === 1 ? design[0].id : null;
  const skillsByName = new Map<string, BackfillSkillRow[]>();
  for (const skill of input.skills) {
    const rows = skillsByName.get(skill.nameEn) ?? [];
    rows.push(skill);
    skillsByName.set(skill.nameEn, rows);
  }

  const categoryUpdates: ServiceJobBackfillPlan['categoryUpdates'] = [];
  const skillLinks: ServiceJobBackfillPlan['skillLinks'] = [];
  const skippedSkillTokens: ServiceJobBackfillPlan['skippedSkillTokens'] = [];

  for (const job of input.jobs) {
    if (job.deletedAt) continue;
    if (
      designCategoryId &&
      job.categoryId == null &&
      job.exploreTag === SAFE_JOB_CATEGORY_TAG
    ) {
      categoryUpdates.push({ listingId: job.id, categoryId: designCategoryId });
    }
    if (job.linkedSkillCount > 0) continue;
    const seen = new Set<string>();
    let position = 0;
    for (const token of job.skills) {
      if (!SAFE_JOB_SKILL_NAME_SET.has(token)) {
        skippedSkillTokens.push({
          listingId: job.id,
          token,
          reason: 'not-allow-listed',
        });
        continue;
      }
      const matches = (skillsByName.get(token) ?? []).filter(
        (skill) => skill.isActive && skill.categoryActive,
      );
      if (matches.length !== 1) {
        skippedSkillTokens.push({
          listingId: job.id,
          token,
          reason: 'not-exactly-one-active-skill',
        });
        continue;
      }
      if (seen.has(matches[0].id)) continue;
      seen.add(matches[0].id);
      skillLinks.push({
        listingId: job.id,
        skillId: matches[0].id,
        position,
      });
      position += 1;
    }
  }

  return {
    designCategoryId,
    categoryUpdates,
    skillLinks,
    skippedSkillTokens,
    serviceCategoryUpdates: 0,
    serviceSkillLinks: 0,
  };
}
