import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  BOOTSTRAP_TAXONOMY,
  TaxonomyCatalogError,
  UNMAPPED_LEGACY_STRINGS,
  assertBootstrapTaxonomy,
  type TaxonomyCategorySeed,
} from './bootstrap-taxonomy';
import { normalizeSkillTerm } from './normalize-skill-term';
import { seedId } from '../../../prisma/seed/ids';
import { seedTaxonomy, taxonomySeedPlan } from '../../../prisma/seed/taxonomy';

describe('bootstrap taxonomy', () => {
  const plan = taxonomySeedPlan();

  it('gives every skill one category, a stable key, and its canonical term', () => {
    const keys = new Set<string>();
    for (const category of BOOTSTRAP_TAXONOMY) {
      expect(plan.categories.map((row) => row.slug)).toContain(category.slug);
      for (const skill of category.skills) {
        expect(keys.has(skill.key)).toBe(false);
        keys.add(skill.key);
        const row = plan.skills.find((item) => item.slug === skill.slug);
        expect(row?.categoryId).toBe(seedId(`category:${category.key}`));
        expect(row?.id).toBe(seedId(`skill:${skill.key}`));
        expect(row).not.toHaveProperty('nameAr');
        const canonicalTerm = plan.terms.find(
          (term) =>
            term.id === seedId(`skill-term:${skill.key}:canonical`) &&
            term.skillId === row?.id,
        );
        expect(canonicalTerm?.term).toBe(skill.nameEn);
        expect(canonicalTerm?.normalizedTerm).toBe(
          normalizeSkillTerm(skill.nameEn),
        );
      }
    }
    expect(
      plan.terms.find((term) => term.normalizedTerm === 'photographer')?.id,
    ).toBe(seedId('skill-term:photography:photographer'));
  });

  it('keeps the same ids when a slug or English name changes', () => {
    const original = taxonomySeedPlan([
      {
        key: 'design',
        slug: 'design',
        nameEn: 'Design',
        sortOrder: 1,
        skills: [
          {
            key: 'ui-design',
            slug: 'ui-design',
            nameEn: 'UI Design',
            sortOrder: 1,
          },
        ],
      },
    ]);
    const renamed = taxonomySeedPlan([
      {
        key: 'design',
        slug: 'visual',
        nameEn: 'Visual',
        sortOrder: 2,
        skills: [
          {
            key: 'ui-design',
            slug: 'interface-design',
            nameEn: 'Interface Design',
            sortOrder: 3,
          },
        ],
      },
    ]);
    expect(renamed.categories[0]?.id).toBe(original.categories[0]?.id);
    expect(renamed.skills[0]?.id).toBe(original.skills[0]?.id);
    expect(renamed.terms[0]?.id).toBe(original.terms[0]?.id);
    expect(renamed.terms[0]?.normalizedTerm).toBe('interface design');
  });

  it('keeps normalized terms globally unique', () => {
    const seen = new Set<string>();
    for (const term of plan.terms) {
      expect(seen.has(term.normalizedTerm)).toBe(false);
      seen.add(term.normalizedTerm);
    }
  });

  it('does not treat related legacy strings as aliases', () => {
    const normalized = new Set(plan.terms.map((term) => term.normalizedTerm));
    for (const legacy of UNMAPPED_LEGACY_STRINGS) {
      expect(normalized.has(normalizeSkillTerm(legacy))).toBe(false);
    }
    expect(normalizeSkillTerm('Tech')).not.toBe('technology');
    expect(normalizeSkillTerm('UI Design')).not.toBe(
      normalizeSkillTerm('UX Design'),
    );
    expect(normalizeSkillTerm('Video Editing')).not.toBe('videography');
    expect(normalizeSkillTerm('Motion Design')).not.toBe('motion graphics');
    expect(normalizeSkillTerm('Illustrator')).not.toBe('illustration');
  });

  it('seeds the launch categories and no retired bootstrap category', () => {
    expect(BOOTSTRAP_TAXONOMY.map((category) => category.key)).toEqual([
      'photography',
      'video',
      'design',
      'beauty',
      'music-audio',
      'events',
      'food',
      'content',
      'technology',
      'marketing',
    ]);
    expect(
      BOOTSTRAP_TAXONOMY.map((category) => [category.slug, category.nameEn]),
    ).toEqual([
      ['photography', 'Photography'],
      ['video-film', 'Video & Film'],
      ['design', 'Design'],
      ['beauty', 'Beauty'],
      ['music-audio', 'Music & Audio'],
      ['events', 'Events'],
      ['food', 'Food'],
      ['content-social-media', 'Content & Social Media'],
      ['technology', 'Technology'],
      ['marketing', 'Marketing'],
    ]);
    expect(BOOTSTRAP_TAXONOMY.map((category) => category.sortOrder)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
    for (const retired of ['product', 'social', 'web']) {
      expect(
        BOOTSTRAP_TAXONOMY.some((category) => category.key === retired),
      ).toBe(false);
    }
  });

  it('keeps the approved skill in each launch category', () => {
    expect(namesIn('photography')).toContain('Wedding Photography');
    expect(namesIn('video')).toContain('Motion Graphics');
    expect(namesIn('design')).toEqual(
      expect.arrayContaining([
        'Branding',
        'UI Design',
        'UX Design',
        'UI/UX Design',
      ]),
    );
    expect(namesIn('beauty')).toContain('Bridal Makeup');
    expect(namesIn('music-audio')).toContain('Oud');
    expect(namesIn('events')).toContain('Event Planning');
    expect(namesIn('food')).toContain('Private Chef');
    expect(namesIn('content')).toContain('Social Media Management');
    expect(namesIn('technology')).toContain('React Native');
    expect(namesIn('marketing')).toContain('SEO');
    expect(namesIn('food')).not.toContain('Food');
    expect(namesIn('design')).not.toContain('Editorial');
    expect(namesIn('design')).not.toContain('Packaging');
    expect(namesIn('video')).not.toContain('Motion');
    expect(namesIn('video')).not.toContain('Motion Design');
  });

  it('counts the launch catalog and resolves only equivalent aliases', () => {
    const skills = BOOTSTRAP_TAXONOMY.flatMap((category) => category.skills);
    const aliases = skills.flatMap((item) => item.aliases ?? []);
    expect(BOOTSTRAP_TAXONOMY).toHaveLength(10);
    expect(skills).toHaveLength(95);
    expect(aliases).toHaveLength(64);
    expect(plan.categories).toHaveLength(10);
    expect(plan.skills).toHaveLength(95);
    expect(plan.terms).toHaveLength(159);

    expect(skillNameFor('Photographer')).toBe('Photography');
    expect(skillNameFor('Videographer')).toBe('Videography');
    expect(skillNameFor('Video Editor')).toBe('Video Editing');
    expect(skillNameFor('Vocalist')).toBe('Singer');
    expect(skillNameFor('Caterer')).toBe('Catering');
    expect(skillNameFor('UI/UX')).toBe('UI/UX Design');
    expect(skillNameFor('UI Design')).toBe('UI Design');
    expect(skillNameFor('UX Design')).toBe('UX Design');

    for (const rejected of [
      'Social Media Marketing',
      'Event Management',
      'Brand Identity',
      'Brand Guidelines',
      'Reels',
      'Packaging',
      'User Research',
      'Portrait',
      'Motion Design',
      'Motion Designer',
      'Illustrator',
      'Event Coordinator',
      'Producer',
      'Influencer',
      'Host',
      'MC',
    ]) {
      expect(plan.terms.some((term) => term.term === rejected)).toBe(false);
      expect(
        plan.terms.some(
          (term) => term.normalizedTerm === normalizeSkillTerm(rejected),
        ),
      ).toBe(false);
    }
  });

  it('maps every normalized term to exactly one skill', () => {
    const owners = new Map<string, string>();
    for (const category of BOOTSTRAP_TAXONOMY) {
      for (const item of category.skills) {
        const raws = [
          item.nameEn,
          ...(item.aliases ?? []).map((entry) => entry.term),
        ];
        for (const raw of raws) {
          const normalized = normalizeSkillTerm(raw);
          expect(owners.has(normalized)).toBe(false);
          owners.set(normalized, item.key);
        }
      }
    }
    expect(owners.size).toBe(plan.terms.length);
    for (const term of plan.terms) {
      const skill = plan.skills.find((item) => item.id === term.skillId);
      expect(owners.get(term.normalizedTerm)).toBe(
        [...BOOTSTRAP_TAXONOMY.flatMap((category) => category.skills)].find(
          (item) => seedId(`skill:${item.key}`) === skill?.id,
        )?.key,
      );
    }
  });

  it('does not change ids when video, content, makeup, or motion graphics labels change', () => {
    const renamed = BOOTSTRAP_TAXONOMY.map((category) => {
      if (category.key === 'video') {
        return {
          ...category,
          slug: 'moving-image',
          nameEn: 'Moving Image',
          skills: category.skills.map((item) =>
            item.key === 'motion-graphics'
              ? { ...item, slug: 'motion-pictures', nameEn: 'Motion Pictures' }
              : item,
          ),
        };
      }
      if (category.key === 'content') {
        return { ...category, slug: 'publishing', nameEn: 'Publishing' };
      }
      if (category.key === 'beauty') {
        return {
          ...category,
          skills: category.skills.map((item) =>
            item.key === 'makeup'
              ? { ...item, slug: 'makeup-artists', nameEn: 'Makeup Artists' }
              : item,
          ),
        };
      }
      return category;
    });
    const next = taxonomySeedPlan(renamed);
    expect(next.categories.find((row) => row.slug === 'moving-image')?.id).toBe(
      seedId('category:video'),
    );
    expect(next.categories.find((row) => row.slug === 'publishing')?.id).toBe(
      seedId('category:content'),
    );
    expect(next.skills.find((row) => row.slug === 'makeup-artists')?.id).toBe(
      seedId('skill:makeup'),
    );
    expect(next.skills.find((row) => row.slug === 'motion-pictures')?.id).toBe(
      seedId('skill:motion-graphics'),
    );
    expect(plan.categories.find((row) => row.slug === 'video-film')?.id).toBe(
      seedId('category:video'),
    );
    expect(
      plan.categories.find((row) => row.slug === 'content-social-media')?.id,
    ).toBe(seedId('category:content'));
  });

  it('rejects a term that would belong to two skills', () => {
    const broken: TaxonomyCategorySeed[] = [
      {
        key: 'design',
        slug: 'design',
        nameEn: 'Design',
        sortOrder: 1,
        skills: [
          {
            key: 'ui-design',
            slug: 'ui-design',
            nameEn: 'UI Design',
            sortOrder: 1,
          },
          {
            key: 'ux-design',
            slug: 'ux-design',
            nameEn: 'UX Design',
            sortOrder: 2,
            aliases: [{ key: 'ui', term: 'UI Design' }],
          },
        ],
      },
    ];
    expect(() => assertBootstrapTaxonomy(broken)).toThrow(TaxonomyCatalogError);
  });

  it('rejects an empty alias', () => {
    const broken: TaxonomyCategorySeed[] = [
      {
        key: 'design',
        slug: 'design',
        nameEn: 'Design',
        sortOrder: 1,
        skills: [
          {
            key: 'branding',
            slug: 'branding',
            nameEn: 'Branding',
            sortOrder: 1,
            aliases: [{ key: 'blank', term: '   ' }],
          },
        ],
      },
    ];
    expect(() => assertBootstrapTaxonomy(broken)).toThrow(/empty term/);
  });
});

describe('taxonomy seed', () => {
  function memory() {
    const categories = new Map<string, { id: string; slug: string }>();
    const skills = new Map<
      string,
      { id: string; categoryId: string; slug: string }
    >();
    const terms = new Map<
      string,
      { id: string; skillId: string; term: string; normalizedTerm: string }
    >();
    const byNorm = new Map<
      string,
      { id: string; skillId: string; term: string; normalizedTerm: string }
    >();
    const termUpdates: unknown[] = [];
    const categoryUpdates: unknown[] = [];
    const skillUpdates: unknown[] = [];
    const transactionOptions: { maxWait?: number; timeout?: number }[] = [];

    const client = {
      $transaction: (
        fn: (tx: typeof client) => Promise<{
          categories: number;
          skills: number;
          terms: number;
        }>,
        options?: { maxWait?: number; timeout?: number },
      ) => {
        transactionOptions.push(options);
        return fn(client);
      },
      category: {
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: { id: string; slug: string };
          update: Record<string, unknown>;
        }) => {
          categoryUpdates.push(update);
          const row = categories.get(where.id)
            ? { ...categories.get(where.id)!, ...update, id: where.id }
            : create;
          categories.set(where.id, row);
          return row;
        },
      },
      skill: {
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: { id: string; categoryId: string; slug: string };
          update: Record<string, unknown>;
        }) => {
          skillUpdates.push(update);
          const row = skills.get(where.id)
            ? { ...skills.get(where.id)!, ...update, id: where.id }
            : create;
          skills.set(where.id, row);
          return row;
        },
      },
      skillTerm: {
        findUnique: ({ where }: { where: { normalizedTerm: string } }) =>
          byNorm.get(where.normalizedTerm) ?? null,
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: {
            id: string;
            skillId: string;
            term: string;
            normalizedTerm: string;
          };
          update: { term: string; normalizedTerm: string };
        }) => {
          termUpdates.push(update);
          const existing = terms.get(where.id);
          const row = existing
            ? { ...existing, ...update, id: where.id }
            : create;
          const clash = byNorm.get(row.normalizedTerm);
          if (clash && clash.id !== row.id) {
            throw new Error('unique normalized term');
          }
          if (existing) byNorm.delete(existing.normalizedTerm);
          terms.set(row.id, row);
          byNorm.set(row.normalizedTerm, row);
          return row;
        },
        deleteMany: ({
          where,
        }: {
          where: { skillId: string; id: { notIn: string[] } };
        }) => {
          let count = 0;
          for (const [id, row] of [...terms]) {
            if (row.skillId === where.skillId && !where.id.notIn.includes(id)) {
              terms.delete(id);
              byNorm.delete(row.normalizedTerm);
              count += 1;
            }
          }
          return { count };
        },
      },
    };

    return {
      client: client as unknown as PrismaClient,
      categories,
      skills,
      terms,
      termUpdates,
      categoryUpdates,
      skillUpdates,
      transactionOptions,
    };
  }

  it('is idempotent and does not move an existing term to another skill', async () => {
    const db = memory();
    const first = await seedTaxonomy(db.client);
    const idsAfterFirst = {
      categories: [...db.categories.keys()].sort(),
      skills: [...db.skills.keys()].sort(),
      terms: [...db.terms.keys()].sort(),
    };
    const second = await seedTaxonomy(db.client);
    const third = await seedTaxonomy(db.client);

    expect(first).toEqual({ categories: 10, skills: 95, terms: 159 });
    expect(db.transactionOptions[0]?.timeout).toBeGreaterThanOrEqual(60_000);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(db.categories.size).toBe(first.categories);
    expect(db.skills.size).toBe(first.skills);
    expect(db.terms.size).toBe(first.terms);
    expect([...db.categories.keys()].sort()).toEqual(idsAfterFirst.categories);
    expect([...db.skills.keys()].sort()).toEqual(idsAfterFirst.skills);
    expect([...db.terms.keys()].sort()).toEqual(idsAfterFirst.terms);
    for (const update of db.termUpdates) {
      expect(update).not.toHaveProperty('skillId');
    }

    const photography = [...db.terms.values()].find(
      (term) => term.normalizedTerm === 'photographer',
    );
    expect(photography?.skillId).toBe(seedId('skill:photography'));
    photography!.skillId = 'other-skill';

    await expect(seedTaxonomy(db.client)).rejects.toThrow(/different skill/);
    expect(photography?.skillId).toBe('other-skill');
  });

  it('does not clear Arabic or an active flag, and drops a removed alias', async () => {
    const db = memory();
    await seedTaxonomy(db.client);
    const design = [...db.categories.values()].find(
      (row) => row.slug === 'design',
    );
    const branding = [...db.skills.values()].find(
      (row) => row.slug === 'branding',
    );
    Object.assign(design ?? {}, { nameAr: 'تصميم' });
    Object.assign(branding ?? {}, { isActive: false });

    await seedTaxonomy(db.client);

    expect(design).toMatchObject({ nameAr: 'تصميم' });
    expect(branding).toMatchObject({ isActive: false });
    for (const update of [...db.categoryUpdates, ...db.skillUpdates]) {
      expect(update).not.toHaveProperty('nameAr');
      expect(update).not.toHaveProperty('isActive');
    }

    const photoSkill: TaxonomyCategorySeed['skills'][number] = {
      key: 'photography',
      slug: 'photography',
      nameEn: 'Photography',
      sortOrder: 1,
    };
    const withAlias: TaxonomyCategorySeed[] = [
      {
        key: 'photography',
        slug: 'photography',
        nameEn: 'Photography',
        sortOrder: 1,
        skills: [
          {
            ...photoSkill,
            aliases: [{ key: 'photographer', term: 'Photographer' }],
          },
        ],
      },
    ];
    const withoutAlias: TaxonomyCategorySeed[] = [
      {
        key: 'photography',
        slug: 'photography',
        nameEn: 'Photography',
        sortOrder: 1,
        skills: [photoSkill],
      },
    ];
    const onlyPhoto = memory();
    await seedTaxonomy(onlyPhoto.client, withAlias);
    await seedTaxonomy(onlyPhoto.client, withoutAlias);
    expect(
      [...onlyPhoto.terms.values()].map((term) => term.normalizedTerm).sort(),
    ).toEqual(['photography']);
  });
});

describe('taxonomy migration boundary', () => {
  const root = join(__dirname, '../../..');
  const migration = readFileSync(
    join(
      root,
      'prisma/migrations/20261019140000_taxonomy_categories_skills_terms/migration.sql',
    ),
    'utf8',
  );
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');

  it('locks the new tables and does not touch existing domain tables', () => {
    for (const table of ['categories', 'skills', 'skill_terms']) {
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`,
      );
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(migration.toLowerCase()).not.toContain('create policy');
    expect(migration.toLowerCase()).not.toContain('force row level security');
    expect(migration.toLowerCase()).not.toContain('grant ');
    for (const legacy of ['user_skills', 'service_offerings', 'job_listings']) {
      expect(migration.toLowerCase()).not.toContain(legacy);
    }
  });

  it('links profile skills only and does not add taxonomy to services or jobs', () => {
    const userSkill = modelBlock(schema, 'UserSkill');
    expect(userSkill).toContain('skillId');
    expect(userSkill).toContain('String?');
    expect(userSkill).toContain('onDelete: Restrict');
    expect(modelBlock(schema, 'ServiceOffering')).not.toContain('categoryId');
    expect(modelBlock(schema, 'ServiceOffering')).not.toContain('Skill');
    expect(modelBlock(schema, 'JobListing')).not.toContain('categoryId');
    expect(modelBlock(schema, 'JobListing')).toContain('skills');
    expect(modelBlock(schema, 'JobListing')).not.toContain('skillId');
    const skill = modelBlock(schema, 'Skill');
    expect(skill).toContain('categoryId String');
    expect(skill).not.toContain('categoryId String[]');
  });
});

function namesIn(categoryKey: string): string[] {
  return (
    BOOTSTRAP_TAXONOMY.find(
      (category) => category.key === categoryKey,
    )?.skills.map((item) => item.nameEn) ?? []
  );
}

function skillNameFor(raw: string): string | undefined {
  const plan = taxonomySeedPlan();
  const normalized = normalizeSkillTerm(raw);
  const term = plan.terms.find((item) => item.normalizedTerm === normalized);
  return plan.skills.find((item) => item.id === term?.skillId)?.nameEn;
}

function modelBlock(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`missing model ${name}`);
  return match[0];
}
