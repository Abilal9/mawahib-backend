import { Prisma } from '@prisma/client';
import {
  serviceOrder,
  serviceWhere,
  talentOrder,
  talentWhere,
} from './explore-sql';

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

describe('explore SQL', () => {
  it('ranks the default talent feed by a public signal, then newest, not followers', () => {
    const order = sqlText(talentOrder({ sort: 'recommended' }));
    expect(order).toContain('created_at DESC');
    expect(order).toContain('u.id ASC');
    expect(order).toContain('service_offerings');
    expect(order).toContain('user_skills');
    expect(order.toLowerCase()).not.toContain('followers');
  });

  it('puts exact username and name ahead of bio when q is present', () => {
    const order = sqlText(talentOrder({ sort: 'recommended', q: 'layla' }));
    const username = order.indexOf('lower(u.username)');
    const name = order.indexOf('lower(u.display_name)');
    const bio = order.indexOf('p.bio');
    const partialName = order.indexOf('u.display_name ILIKE');
    expect(username).toBeGreaterThanOrEqual(0);
    expect(name).toBeGreaterThan(username);
    expect(partialName).toBeGreaterThan(name);
    expect(bio).toBeGreaterThan(partialName);
    expect(order).toContain('rating_avg DESC');
    expect(order.toLowerCase()).not.toContain('followers');
  });

  it('limits talent discovery text to published services and the viewer', () => {
    const where = sqlText(
      talentWhere({
        viewerId: 'viewer-1',
        accountType: 'talent',
        q: 'photo',
        locationCode: 'riyadh',
        includeSkillsAndServices: true,
      }),
    );
    expect(where).toContain('published');
    expect(where).toContain('deleted_at IS NULL');
    expect(where).toContain('location_code');
    expect(where).not.toContain('draft');
  });

  it('does not search business bios or services', () => {
    const where = sqlText(
      talentWhere({
        viewerId: 'viewer-1',
        accountType: 'business',
        q: 'studio',
        includeSkillsAndServices: false,
      }),
    );
    expect(where).toContain('display_name');
    expect(where).toContain('username');
    expect(where).not.toContain('user_skills');
    expect(where).not.toContain('service_offerings');
    expect(where).not.toContain('p.bio');
  });

  it('orders services by newest and never by offering rating', () => {
    const order = sqlText(serviceOrder());
    expect(order).toContain('so.created_at DESC');
    expect(order).not.toContain('so.rating_avg');
  });

  it('ranks service title before description and ties with the provider rating', () => {
    const order = sqlText(serviceOrder('brand'));
    expect(order.indexOf('so.title')).toBeLessThan(order.indexOf('so.description'));
    expect(order).toContain('u.rating_avg DESC');
    expect(order).not.toContain('so.rating_avg');
  });

  it('keeps service search on published offerings and the provider city', () => {
    const where = sqlText(
      serviceWhere({ q: 'brand', locationCode: 'riyadh' }),
    );
    expect(where).toContain('published');
    expect(where).toContain('so.deleted_at IS NULL');
    expect(where).toContain('location_code');
    expect(where).toContain('u.display_name');
  });
});

const categoryId = '00000000-0000-4000-8000-0000000000aa';
const skillId = '00000000-0000-4000-8000-0000000000bb';
const otherSkillId = '00000000-0000-4000-8000-0000000000cc';

describe('explore taxonomy SQL', () => {
  const baseTalent = {
    viewerId: 'viewer-1',
    accountType: 'talent' as const,
    includeSkillsAndServices: true,
  };

  it('leaves the unfiltered talent and service predicates unchanged', () => {
    const talent = sqlText(talentWhere(baseTalent));
    const talentEmpty = sqlText(
      talentWhere({ ...baseTalent, categoryIds: [], searchSkillIds: [] }),
    );
    expect(talentEmpty).toBe(talent);
    expect(talent).not.toContain('sk.category_id');
    expect(talent).not.toContain('service_skills');

    const service = sqlText(serviceWhere({}));
    const serviceEmpty = sqlText(
      serviceWhere({ categoryIds: [], searchSkillIds: [] }),
    );
    expect(serviceEmpty).toBe(service);
    expect(service).not.toContain('category_id');
    expect(service).not.toContain('service_skills');
  });

  it('matches talent categories from an active canonical skill, not profile text', () => {
    const where = sqlText(
      talentWhere({ ...baseTalent, categoryIds: [categoryId] }),
    );
    expect(where).toContain('JOIN skills sk');
    expect(where).toContain('sk.is_active = true');
    expect(where).toContain(categoryId);
    expect(where).toContain('sk.category_id IN');
    expect(where).not.toContain('service_offerings');
    expect(where).not.toContain('service_skills');
    expect(where).not.toMatch(/OR EXISTS \(\s*SELECT 1 FROM user_skills us\s*JOIN skills/);
  });

  it('ORs a canonical talent skill into text search and ANDs the category', () => {
    const where = sqlText(
      talentWhere({
        ...baseTalent,
        q: 'underwater',
        categoryIds: [categoryId],
        searchSkillIds: [skillId, otherSkillId],
      }),
    );
    expect(where).toContain('s.skill ILIKE');
    expect(where).toContain('us.skill_id IN');
    expect(where).toContain(skillId);
    expect(where).toContain(otherSkillId);
    expect(where).toContain(categoryId);
    expect(where.match(/us\.skill_id IN/g)).toHaveLength(1);
    expect(where.indexOf('us.skill_id IN')).toBeLessThan(where.indexOf('sk.category_id'));
    expect(where).not.toMatch(/OR EXISTS \(\s*SELECT 1 FROM user_skills us\s*JOIN skills/);
    const order = sqlText(talentOrder({ sort: 'recommended', q: 'underwater' }));
    expect(order).not.toContain('category_id');
    expect(order).not.toContain('skill_id');
    expect(order).toContain('ELSE 10');
  });

  it('does not add a skill branch for an empty resolution or a business rail', () => {
    const textOnly = sqlText(
      talentWhere({ ...baseTalent, q: 'figma', searchSkillIds: [] }),
    );
    expect(textOnly).toContain('s.skill ILIKE');
    expect(textOnly).not.toContain('skill_id');
    const noQuery = sqlText(
      talentWhere({ ...baseTalent, searchSkillIds: [skillId] }),
    );
    expect(noQuery).not.toContain('skill_id');
    const business = sqlText(
      talentWhere({
        viewerId: 'viewer-1',
        accountType: 'business',
        q: 'figma',
        includeSkillsAndServices: false,
        searchSkillIds: [skillId],
      }),
    );
    expect(business).toContain('display_name');
    expect(business).not.toContain('skill_id');
    expect(business).not.toContain('user_skills');
  });

  it('does not infer a talent category from a published service', () => {
    const where = sqlText(
      talentWhere({ ...baseTalent, q: 'design', categoryIds: [categoryId] }),
    );
    const categoryAt = where.indexOf('sk.category_id');
    const serviceAt = where.indexOf('service_offerings');
    expect(categoryAt).toBeGreaterThan(serviceAt);
    expect(where.slice(categoryAt)).not.toContain('service_offerings');
  });

  it('filters services by canonical category without treating text as a category', () => {
    const where = sqlText(serviceWhere({ categoryIds: [categoryId] }));
    expect(where).toContain(`so.category_id IN`);
    expect(where).toContain(categoryId);
    expect(where).not.toContain('service_skills');
    expect(where.replace(/so\.category_id/g, '')).not.toContain('so.category');
    expect(where).not.toContain('category_id IS NULL');
    const order = sqlText(serviceOrder());
    expect(order).toContain('so.created_at DESC');
    expect(order).not.toContain('category_id');
    expect(order).not.toContain('skill_id');
  });

  it('ORs a canonical service skill into text search and ANDs the category', () => {
    const where = sqlText(
      serviceWhere({
        q: 'After Effects',
        categoryIds: [categoryId],
        searchSkillIds: [skillId, otherSkillId],
      }),
    );
    expect(where).toContain('so.title ILIKE');
    expect(where).toContain('service_skills');
    expect(where).toContain(skillId);
    expect(where).toContain(otherSkillId);
    expect(where.match(/ss\.skill_id IN/g)).toHaveLength(1);
    expect(where.indexOf('so.title ILIKE')).toBeLessThan(where.indexOf('ss.skill_id'));
    expect(where.indexOf('ss.skill_id')).toBeLessThan(where.indexOf('so.category_id'));
    const searched = sqlText(serviceOrder('After Effects'));
    expect(searched).toContain('ELSE 5');
    expect(searched).not.toContain('skill_id');
    const textOnly = sqlText(serviceWhere({ q: 'After Effects', searchSkillIds: [] }));
    expect(textOnly).not.toContain('service_skills');
    const categoryOnly = sqlText(
      serviceWhere({ searchSkillIds: [skillId], categoryIds: [categoryId] }),
    );
    expect(categoryOnly).not.toContain('service_skills');
  });
});
