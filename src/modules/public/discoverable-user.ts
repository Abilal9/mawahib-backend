import { AccountStatus, Prisma } from '@prisma/client';

/** Public discovery: live Mawahib row that is ACTIVE and not soft-deleted. */
export const discoverableUserWhere = {
  deletedAt: null,
  accountStatus: AccountStatus.ACTIVE,
} as const satisfies Prisma.UserWhereInput;

export function discoverableUserSql(): Prisma.Sql {
  return Prisma.sql`u.deleted_at IS NULL AND u.account_status = CAST('ACTIVE' AS "AccountStatus")`;
}
