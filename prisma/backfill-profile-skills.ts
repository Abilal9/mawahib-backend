/**
 * One-time profile skill backfill. Not run on application startup.
 *
 * Dry run (default):
 *   ./node_modules/.bin/ts-node --transpile-only prisma/backfill-profile-skills.ts
 *
 * Apply:
 *   ./node_modules/.bin/ts-node --transpile-only prisma/backfill-profile-skills.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import {
  decideProfileSkillBackfill,
  type BackfillTarget,
} from '../src/modules/users/profile-skill-backfill';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const [rows, skills] = await Promise.all([
    prisma.userSkill.findMany({
      select: { userId: true, skill: true, skillId: true, position: true },
    }),
    prisma.skill.findMany({
      select: {
        id: true,
        slug: true,
        nameEn: true,
        isActive: true,
        category: { select: { isActive: true } },
      },
    }),
  ]);
  const targets = new Map<string, BackfillTarget>(
    skills.map((skill) => [
      skill.slug,
      {
        slug: skill.slug,
        id: skill.id,
        nameEn: skill.nameEn,
        active: skill.isActive && skill.category.isActive,
      },
    ]),
  );
  const decisions = decideProfileSkillBackfill(rows, targets);
  const links = decisions.filter((row) => row.action === 'link');
  const left = decisions.filter((row) => row.action === 'leave');
  const byReason = new Map<string, number>();
  for (const row of left) {
    const reason = row.reason ?? 'unknown';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const unmatched = [
    ...new Set(
      left
        .filter((row) => row.reason === 'unmatched')
        .map((row) => row.skill),
    ),
  ].sort();

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        rows: rows.length,
        link: links.length,
        leave: left.length,
        reasons: Object.fromEntries(byReason),
        unmatched,
      },
      null,
      2,
    ),
  );

  if (!apply) return;

  const byUser = new Map<string, typeof links>();
  for (const link of links) {
    const list = byUser.get(link.userId) ?? [];
    list.push(link);
    byUser.set(link.userId, list);
  }

  for (const [userId, userLinks] of byUser) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM users WHERE id = CAST(${userId} AS uuid) FOR UPDATE
      `;
      for (const link of userLinks) {
        await tx.userSkill.update({
          where: { userId_skill: { userId, skill: link.skill } },
          data: { skillId: link.skillId, skill: link.nextText },
        });
      }
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
