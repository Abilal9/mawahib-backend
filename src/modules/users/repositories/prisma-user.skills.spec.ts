import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { PrismaUserRepository } from './prisma-user.repository';

describe('PrismaUserRepository profile skills', () => {
  function repository() {
    const steps: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async () => {
        steps.push('lock');
        return [];
      }),
      userSkill: {
        findMany: jest.fn(async () => {
          steps.push('load');
          return [
            {
              userId: 'user-1',
              skill: 'Drums',
              skillId: null,
              position: 0,
              createdAt: new Date('2026-01-01'),
            },
          ];
        }),
        deleteMany: jest.fn(async () => {
          steps.push('delete');
          return { count: 1 };
        }),
        createMany: jest.fn(async () => {
          steps.push('insert');
          return { count: 1 };
        }),
      },
      skill: {
        findMany: jest.fn(async () => {
          steps.push('catalog');
          return [];
        }),
      },
      skillTerm: {
        findMany: jest.fn(async () => []),
      },
      user: {
        update: jest.fn(async () => {
          steps.push('user');
          throw new Error('profile update should not run');
        }),
      },
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };
    return {
      steps,
      tx,
      repo: new PrismaUserRepository(prisma as never),
    };
  }

  it('leaves the stored skills untouched when a skill id is unknown', async () => {
    const { repo, steps, tx } = repository();

    await expect(
      repo.updateOwn('11111111-1111-4111-8111-111111111111', {
        skillSelections: [{ skillId: '22222222-2222-4222-8222-222222222222' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(steps).toEqual(['lock', 'load', 'catalog']);
    expect(tx.userSkill.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces skills in order only after the selection resolves', async () => {
    const { repo, tx } = repository();
    tx.skill.findMany.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        nameEn: 'Photography',
        isActive: true,
        category: { isActive: true },
      },
    ]);
    tx.user.update.mockResolvedValue({ id: 'user-1' });

    await repo.updateOwn('11111111-1111-4111-8111-111111111111', {
      skillSelections: [
        { text: 'Drums' },
        { skillId: '22222222-2222-4222-8222-222222222222' },
      ],
    });

    expect(tx.userSkill.deleteMany).toHaveBeenCalledWith({
      where: { userId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(tx.userSkill.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          skill: 'Drums',
          skillId: null,
          position: 0,
        },
        {
          userId: '11111111-1111-4111-8111-111111111111',
          skill: 'Photography',
          skillId: '22222222-2222-4222-8222-222222222222',
          position: 1,
        },
      ],
    });
  });
});

describe('user skill taxonomy migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../../prisma/migrations/20261019210000_user_skill_taxonomy_link/migration.sql',
    ),
    'utf8',
  );

  it('adds a nullable skill link without touching other domains', () => {
    expect(sql).toContain('ADD COLUMN "skill_id" UUID');
    expect(sql).toContain('user_skills_skill_id_idx');
    expect(sql).toContain('user_skills_user_id_skill_id_key');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).not.toContain('NOT NULL');
    expect(sql).not.toContain('profiles_phone');
    expect(sql).not.toContain('service_offerings');
    expect(sql).not.toContain('job_listings');
    expect(sql.toLowerCase()).not.toContain('drop ');
  });
});
