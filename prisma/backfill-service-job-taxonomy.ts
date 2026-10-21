/**
 * One-time service/job taxonomy backfill. Not run on application startup.
 *
 * Dry run (default):
 *   ./node_modules/.bin/ts-node --transpile-only prisma/backfill-service-job-taxonomy.ts
 *
 * Apply:
 *   ./node_modules/.bin/ts-node --transpile-only prisma/backfill-service-job-taxonomy.ts --apply
 *
 * Legacy category, exploreTag, and skills[] text are never rewritten.
 */
import { PrismaClient } from '@prisma/client';
import { planServiceJobBackfill } from '../src/modules/taxonomy/service-job-backfill';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const [serviceCount, jobs, categories, skills] = await Promise.all([
    prisma.serviceOffering.count({ where: { deletedAt: null } }),
    prisma.jobListing.findMany({
      select: {
        id: true,
        deletedAt: true,
        categoryId: true,
        exploreTag: true,
        skills: true,
        _count: { select: { taxonomySkills: true } },
      },
    }),
    prisma.category.findMany({
      select: { id: true, nameEn: true, isActive: true },
    }),
    prisma.skill.findMany({
      select: {
        id: true,
        nameEn: true,
        isActive: true,
        category: { select: { isActive: true } },
      },
    }),
  ]);
  const plan = planServiceJobBackfill({
    jobs: jobs.map((job) => ({
      id: job.id,
      deletedAt: job.deletedAt,
      categoryId: job.categoryId,
      exploreTag: job.exploreTag,
      skills: job.skills,
      linkedSkillCount: job._count.taxonomySkills,
    })),
    categories,
    skills: skills.map((skill) => ({
      id: skill.id,
      nameEn: skill.nameEn,
      isActive: skill.isActive,
      categoryActive: skill.category.isActive,
    })),
  });
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    services: serviceCount,
    jobs: jobs.filter((job) => !job.deletedAt).length,
    serviceCategoryUpdates: plan.serviceCategoryUpdates,
    serviceSkillLinks: plan.serviceSkillLinks,
    jobCategoryUpdates: plan.categoryUpdates.length,
    jobSkillLinks: plan.skillLinks.length,
    skippedSkillTokens: plan.skippedSkillTokens,
    designCategoryResolved: Boolean(plan.designCategoryId),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;

  const listingIds = new Set<string>([
    ...plan.categoryUpdates.map((row) => row.listingId),
    ...plan.skillLinks.map((row) => row.listingId),
  ]);
  for (const listingId of listingIds) {
    const category = plan.categoryUpdates.find((row) => row.listingId === listingId);
    const links = plan.skillLinks.filter((row) => row.listingId === listingId);
    await prisma.$transaction(async (tx) => {
      if (category) {
        await tx.jobListing.updateMany({
          where: {
            id: listingId,
            categoryId: null,
            exploreTag: 'Design',
            deletedAt: null,
          },
          data: { categoryId: category.categoryId },
        });
      }
      if (links.length === 0) return;
      const existing = await tx.jobSkill.count({ where: { listingId } });
      if (existing > 0) return;
      await tx.jobSkill.createMany({ data: links });
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'backfill failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
