import { Prisma } from '@prisma/client';

/** Bound LIKE pattern. `%`, `_`, and `\` are literals, not wildcards. */
export function ilikeContains(raw: string): string {
  const escaped = raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

export const ILIKE_ESCAPE = '\\';

export function talentWhere(input: {
  viewerId: string;
  accountType: 'talent' | 'business';
  q?: string;
  locationCode?: string;
  /** Business hits match name, username, and title only. */
  includeSkillsAndServices: boolean;
}): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`u.deleted_at IS NULL`,
    Prisma.sql`u.account_type = CAST(${input.accountType} AS "AccountType")`,
    Prisma.sql`u.id <> CAST(${input.viewerId} AS uuid)`,
  ];
  if (input.locationCode) {
    clauses.push(Prisma.sql`p.location_code = ${input.locationCode}`);
  }
  const q = input.q?.trim();
  if (q) {
    const like = ilikeContains(q);
    const parts: Prisma.Sql[] = [
      Prisma.sql`u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
      Prisma.sql`u.username ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
      Prisma.sql`COALESCE(p.title, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}`,
    ];
    if (input.includeSkillsAndServices) {
      parts.push(
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
      );
    }
    clauses.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  return Prisma.join(clauses, ' AND ');
}

export function talentOrder(input: {
  sort: 'recommended' | 'top-rated';
  q?: string;
}): Prisma.Sql {
  if (input.sort === 'top-rated') {
    return Prisma.sql`u.rating_avg DESC, u.rating_count DESC, u.created_at DESC, u.id ASC`;
  }
  const q = input.q?.trim();
  if (q) {
    const like = ilikeContains(q);
    return Prisma.sql`
      CASE
        WHEN lower(u.username) = lower(${q}) THEN 1
        WHEN lower(u.display_name) = lower(${q}) THEN 2
        WHEN u.username ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 3
        WHEN u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 4
        WHEN COALESCE(p.title, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 5
        WHEN EXISTS (
          SELECT 1 FROM user_skills s
          WHERE s.user_id = u.id AND s.skill ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
        ) THEN 6
        WHEN EXISTS (
          SELECT 1 FROM service_offerings so
          WHERE so.user_id = u.id
            AND so.deleted_at IS NULL
            AND so.status = CAST('published' AS "ServiceOfferingStatus")
            AND so.title ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
        ) THEN 7
        WHEN EXISTS (
          SELECT 1 FROM service_offerings so
          WHERE so.user_id = u.id
            AND so.deleted_at IS NULL
            AND so.status = CAST('published' AS "ServiceOfferingStatus")
            AND COALESCE(so.category, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
        ) THEN 8
        WHEN COALESCE(p.bio, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 9
        ELSE 10
      END ASC,
      u.rating_avg DESC,
      u.rating_count DESC,
      u.id ASC
    `;
  }
  return Prisma.sql`
    CASE WHEN (
      NULLIF(BTRIM(COALESCE(p.title, '')), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM user_skills s WHERE s.user_id = u.id)
      OR EXISTS (
        SELECT 1 FROM service_offerings so
        WHERE so.user_id = u.id
          AND so.deleted_at IS NULL
          AND so.status = CAST('published' AS "ServiceOfferingStatus")
      )
    ) THEN 0 ELSE 1 END ASC,
    u.created_at DESC,
    u.id ASC
  `;
}

export function businessOrder(q: string): Prisma.Sql {
  const like = ilikeContains(q);
  return Prisma.sql`
    CASE
      WHEN lower(u.username) = lower(${q}) THEN 1
      WHEN lower(u.display_name) = lower(${q}) THEN 2
      WHEN u.username ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 3
      WHEN u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 4
      WHEN COALESCE(p.title, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 5
      ELSE 6
    END ASC,
    u.created_at DESC,
    u.id ASC
  `;
}

export function serviceWhere(input: {
  q?: string;
  locationCode?: string;
}): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`so.deleted_at IS NULL`,
    Prisma.sql`so.status = CAST('published' AS "ServiceOfferingStatus")`,
    Prisma.sql`u.deleted_at IS NULL`,
  ];
  if (input.locationCode) {
    clauses.push(Prisma.sql`p.location_code = ${input.locationCode}`);
  }
  const q = input.q?.trim();
  if (q) {
    const like = ilikeContains(q);
    clauses.push(Prisma.sql`(
      so.title ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      OR COALESCE(so.category, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      OR u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
      OR so.description ILIKE ${like} ESCAPE ${ILIKE_ESCAPE}
    )`);
  }
  return Prisma.join(clauses, ' AND ');
}

export function serviceOrder(q?: string): Prisma.Sql {
  const text = q?.trim();
  if (!text) {
    return Prisma.sql`so.created_at DESC, so.id ASC`;
  }
  const like = ilikeContains(text);
  return Prisma.sql`
    CASE
      WHEN so.title ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 1
      WHEN COALESCE(so.category, '') ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 2
      WHEN u.display_name ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 3
      WHEN so.description ILIKE ${like} ESCAPE ${ILIKE_ESCAPE} THEN 4
      ELSE 5
    END ASC,
    u.rating_avg DESC,
    u.rating_count DESC,
    so.id ASC
  `;
}
