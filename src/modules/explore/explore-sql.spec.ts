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
