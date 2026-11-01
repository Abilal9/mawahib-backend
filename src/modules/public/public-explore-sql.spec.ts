import { Prisma } from '@prisma/client';
import { publicServiceWhere, publicTalentWhere } from './public-explore-sql';

function sqlText(node: Prisma.Sql): string {
  const chunks: string[] = [];
  const visit = (current: Prisma.Sql) => {
    current.strings.forEach((part, index) => {
      chunks.push(part);
      const value = current.values[index];
      if (
        value &&
        typeof value === 'object' &&
        'strings' in (value as object) &&
        'values' in (value as object)
      ) {
        visit(value as Prisma.Sql);
      } else if (value !== undefined) {
        chunks.push(String(value));
      }
    });
  };
  visit(node);
  return chunks.join(' ');
}

const categoryId = '11111111-1111-4111-8111-111111111111';
const skillId = '22222222-2222-4222-8222-222222222222';

describe('public explore SQL category filters', () => {
  it('leaves unfiltered public predicates unchanged', () => {
    const talent = sqlText(publicTalentWhere({}));
    expect(sqlText(publicTalentWhere({ categoryIds: [] }))).toBe(talent);
    expect(talent).not.toContain('sk.category_id');

    const service = sqlText(publicServiceWhere({}));
    expect(sqlText(publicServiceWhere({ categoryIds: [] }))).toBe(service);
    expect(service).not.toContain('so.category_id');
  });

  it('matches public talents by active skill category, not display name', () => {
    const where = sqlText(publicTalentWhere({ categoryIds: [categoryId] }));
    expect(where).toContain('JOIN skills sk');
    expect(where).toContain('sk.is_active = true');
    expect(where).toContain('sk.category_id IN');
    expect(where).toContain(categoryId);
    expect(where).not.toContain('so.category ILIKE');
  });

  it('ANDs public talent category with text search', () => {
    const where = sqlText(
      publicTalentWhere({
        q: 'underwater',
        categoryIds: [categoryId],
        searchSkillIds: [skillId],
      }),
    );
    expect(where).toContain('underwater');
    expect(where).toContain('us.skill_id IN');
    expect(where).toContain('sk.category_id IN');
    expect(where.indexOf('us.skill_id IN')).toBeLessThan(
      where.indexOf('sk.category_id'),
    );
  });

  it('filters public services by category_id rather than category text', () => {
    const where = sqlText(publicServiceWhere({ categoryIds: [categoryId] }));
    expect(where).toContain('so.category_id IN');
    expect(where).toContain(categoryId);
    expect(where.replace(/so\.category_id/g, '')).not.toContain('so.category');
  });

  it('ANDs public service category with text search', () => {
    const where = sqlText(
      publicServiceWhere({
        q: 'logo',
        categoryIds: [categoryId],
        searchSkillIds: [skillId],
      }),
    );
    expect(where).toContain('logo');
    expect(where).toContain('so.category_id IN');
    expect(where).toContain('service_skills');
  });
});
