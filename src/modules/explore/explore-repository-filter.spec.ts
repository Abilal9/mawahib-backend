import { Prisma } from '@prisma/client';
import { PrismaExploreRepository } from './repositories/prisma-explore.repository';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function isSql(value: unknown): value is Prisma.Sql {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    value !== null &&
    'strings' in value &&
    'values' in value
  );
}

function render(value: unknown): string {
  if (!isSql(value)) return value == null ? '' : String(value);
  let out = '';
  value.strings.forEach((part, index) => {
    out += part;
    if (index < value.values.length) out += render(value.values[index]);
  });
  return out;
}

function renderTagged(strings: TemplateStringsArray, values: unknown[]): string {
  let out = '';
  strings.forEach((part, index) => {
    out += part;
    if (index < values.length) out += render(values[index]);
  });
  return out;
}

describe('explore repository taxonomy filters', () => {
  const categoryId = uuid(1);
  const skillA = uuid(2);
  const skillB = uuid(3);
  const captured: string[] = [];
  const prisma = {
    user: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = renderTagged(strings, values);
      captured.push(text);
      if (text.includes('COUNT')) return [{ count: 25 }];
      return [{ id: 'row-1' }];
    }),
  };
  const repo = new PrismaExploreRepository(prisma as never);

  beforeEach(() => {
    captured.length = 0;
    prisma.$queryRaw.mockClear();
  });

  it('applies talent category and search-skill predicates before LIMIT and OFFSET', async () => {
    const page = await repo.searchTalents({
      viewerId: 'viewer-1',
      q: 'photo',
      sort: 'recommended',
      categoryIds: [categoryId],
      searchSkillIds: [skillA, skillB],
      skip: 20,
      take: 5,
    });
    expect(page).toEqual({ ids: ['row-1'], total: 25 });
    const listed = captured.find((sql) => sql.includes('LIMIT'));
    const counted = captured.find((sql) => sql.includes('COUNT'));
    expect(listed).toBeDefined();
    expect(counted).toBeDefined();
    expect(listed!.indexOf(categoryId)).toBeGreaterThanOrEqual(0);
    expect(listed!.indexOf(categoryId)).toBeLessThan(listed!.indexOf('ORDER BY'));
    expect(listed!.indexOf(skillA)).toBeLessThan(listed!.indexOf('LIMIT'));
    expect(listed!.indexOf('ORDER BY')).toBeLessThan(listed!.indexOf('LIMIT'));
    expect(listed).toContain('OFFSET');
    expect(listed).toContain('5');
    expect(listed).toContain('20');
    expect(listed!.match(/us\.skill_id IN/g)).toHaveLength(1);
    expect(listed).not.toContain('JOIN user_skills');
    const order = listed!.slice(listed!.indexOf('ORDER BY'));
    expect(order).not.toContain('category_id');
    expect(order).not.toContain('skill_id');
    expect(counted).toContain(categoryId);
    expect(counted).toContain(skillB);
    expect(counted).not.toContain('LIMIT');
  });

  it('applies service search skills inside the text OR before LIMIT', async () => {
    await repo.searchServices({
      q: 'figma',
      categoryIds: [categoryId],
      searchSkillIds: [skillA, skillB],
      skip: 40,
      take: 10,
    });
    const listed = captured.find((sql) => sql.includes('LIMIT'));
    expect(listed).toBeDefined();
    expect(listed!.indexOf('so.category_id')).toBeLessThan(listed!.indexOf('ORDER BY'));
    expect(listed!.indexOf('ss.skill_id')).toBeLessThan(listed!.indexOf('so.category_id'));
    expect(listed!.indexOf('ORDER BY')).toBeLessThan(listed!.indexOf('LIMIT'));
    expect(listed!.match(/ss\.skill_id IN/g)).toHaveLength(1);
    expect(listed).toContain(skillA);
    expect(listed).toContain(skillB);
    expect(listed!.slice(listed!.indexOf('ORDER BY'))).toContain('ELSE 5');
    expect(listed!.slice(listed!.indexOf('ORDER BY'))).not.toContain('skill_id');
    const counted = captured.find((sql) => sql.includes('COUNT'));
    expect(counted).toContain(categoryId);
    expect(counted).toContain(skillB);
    expect(counted).not.toContain('LIMIT');
  });

  it('does not put resolved skill ids on the business rail', async () => {
    prisma.user = { findMany: jest.fn(async () => []) };
    await repo.searchBusinesses({
      viewerId: 'viewer-1',
      q: 'figma',
      sort: 'recommended',
      skip: 0,
      take: 20,
    });
    const listed = captured.find((sql) => sql.includes('LIMIT'));
    expect(listed).toBeDefined();
    expect(listed).not.toContain('skill_id');
    expect(listed).not.toContain(skillA);
    expect(listed).not.toContain('user_skills');
  });

  it('does not add taxonomy SQL when no filters are set', async () => {
    await repo.searchTalents({
      viewerId: 'viewer-1',
      sort: 'recommended',
      skip: 0,
      take: 20,
    });
    const listed = captured.find((sql) => sql.includes('LIMIT'));
    expect(listed).not.toContain('sk.category_id');
    expect(listed).not.toContain('us.skill_id');
  });
});
