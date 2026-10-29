import { Prisma } from '@prisma/client';
import { ILIKE_ESCAPE, ilikeContains } from '../explore/explore-sql';
import { discoverableUserSql } from './discoverable-user';

function uuidIn(ids: readonly string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
}

/** Viewer-neutral talent discovery. Hardcoded ACTIVE + not deleted. */
export function publicTalentWhere(input: {
  q?: string;
  searchSkillIds?: string[];
}): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    discoverableUserSql(),
    Prisma.sql`u.account_type = CAST('talent' AS "AccountType")`,
  ];
  const q = input.q?.trim();
  if (q) {
    const like = ilikeContains(q);
    const parts: Prisma.Sql[] = [
      Prisma.sql`u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
      Prisma.sql`u.username ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
      Prisma.sql`COALESCE(p.title, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
      Prisma.sql`COALESCE(p.bio, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM user_skills s
        WHERE s.user_id = u.id AND s.skill ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      )`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM service_offerings so
        WHERE so.user_id = u.id
          AND so.deleted_at IS NULL
          AND so.status = CAST('published' AS "ServiceOfferingStatus")
          AND (
            so.title ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
            OR COALESCE(so.category, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
          )
      )`,
    ];
    if (input.searchSkillIds?.length) {
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM user_skills us
        WHERE us.user_id = u.id
          AND us.skill_id IN (${uuidIn(input.searchSkillIds)})
      )`);
    }
    clauses.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  return Prisma.join(clauses, ' AND ');
}

/** Viewer-neutral published services with discoverable providers. */
export function publicServiceWhere(input: {
  q?: string;
  searchSkillIds?: string[];
}): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`so.deleted_at IS NULL`,
    Prisma.sql`so.status = CAST('published' AS "ServiceOfferingStatus")`,
    discoverableUserSql(),
  ];
  const q = input.q?.trim();
  if (q) {
    const like = ilikeContains(q);
    clauses.push(Prisma.sql`(
      so.title ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      OR COALESCE(so.category, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      OR u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      OR so.description ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      ${
        input.searchSkillIds?.length
          ? Prisma.sql`OR EXISTS (
        SELECT 1 FROM service_skills ss
        WHERE ss.offering_id = so.id
          AND ss.skill_id IN (${uuidIn(input.searchSkillIds)})
      )`
          : Prisma.empty
      }
    )`);
  }
  return Prisma.join(clauses, ' AND ');
}
