import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  StaffAuditAction,
  StaffMembershipStatus,
  StaffRole,
} from '@prisma/client';
import { SELF_ACTION_FORBIDDEN, STAFF_ACCESS_DENIED } from '../../common/auth/admission.codes';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { decodeCursor, encodeCursor, optionalCursor, parsePageLimit } from './admin-read.query';

const ACCOUNT_STATUS_CONFLICT = 'ACCOUNT_STATUS_CONFLICT';

export type AccountStatusOutcome = {
  outcome: 'changed' | 'unchanged';
  accountStatus: AccountStatus;
  previousStatus: AccountStatus;
};

export type AccountActionRecord = {
  id: string;
  action: 'account_suspended' | 'account_restored';
  actorSubjectId: string | null;
  actorStaffMemberId: string | null;
  targetAccountId: string | null;
  targetDisplayName: string | null;
  previousStatus: AccountStatus | null;
  resultingStatus: AccountStatus | null;
  reason: string | null;
  createdAt: string;
};

const accountActions = [
  StaffAuditAction.account_suspended,
  StaffAuditAction.account_restored,
] as const;

@Injectable()
export class AccountStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async change(
    actor: { issuer: string; subjectId: string },
    accountId: string,
    body: Record<string, unknown>,
  ): Promise<AccountStatusOutcome> {
    const requested = parseStatus(body.status);
    const expected = parseStatus(body.expectedStatus);
    const reason = parseReason(body.reason);
    return this.prisma.$transaction((tx) =>
      this.changeInTransaction(tx, actor, accountId, expected, requested, reason),
    );
  }

  /**
   * Locks the account row and the actor membership, then writes the status
   * and audit event together. A thrown audit error rolls the status back
   * with the transaction. This does not prove PostgreSQL lock timing by itself.
   */
  async changeInTransaction(
    tx: Prisma.TransactionClient,
    actor: { issuer: string; subjectId: string },
    accountId: string,
    expected: AccountStatus,
    requested: AccountStatus,
    reason: string,
  ): Promise<AccountStatusOutcome> {
    const member = await lockActor(tx, actor.issuer, actor.subjectId);
    if (
      !member ||
      member.status !== StaffMembershipStatus.active ||
      member.role !== StaffRole.operator
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: STAFF_ACCESS_DENIED,
        message: 'Staff access is required.',
      });
    }

    const account = await lockAccount(tx, accountId);
    if (!account || account.deletedAt) {
      throw new NotFoundException('Account not found.');
    }
    if (member.linkedProductUserId === accountId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: SELF_ACTION_FORBIDDEN,
        message: 'An operator cannot change the linked product account from this session.',
      });
    }
    if (account.status === requested) {
      return {
        outcome: 'unchanged',
        accountStatus: account.status,
        previousStatus: account.status,
      };
    }
    if (account.status !== expected) {
      throw new ConflictException({
        statusCode: 409,
        code: ACCOUNT_STATUS_CONFLICT,
        message: 'This account changed. Refresh it before trying again.',
      });
    }

    const updated = await tx.user.updateMany({
      where: { id: accountId, accountStatus: account.status, deletedAt: null },
      data: { accountStatus: requested },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        statusCode: 409,
        code: ACCOUNT_STATUS_CONFLICT,
        message: 'This account changed. Refresh it before trying again.',
      });
    }
    await tx.staffAuditEvent.create({
      data: {
        action:
          requested === AccountStatus.SUSPENDED
            ? StaffAuditAction.account_suspended
            : StaffAuditAction.account_restored,
        targetSubjectId: accountId,
        targetAccountId: accountId,
        actorSubjectId: member.subjectId,
        actorStaffMemberId: member.id,
        unverifiedProcessUser: null,
        previousStatus: account.status,
        resultingStatus: requested,
        reason,
      },
    });
    return {
      outcome: 'changed',
      accountStatus: requested,
      previousStatus: account.status,
    };
  }

  async list(query: Record<string, unknown>): Promise<{
    items: AccountActionRecord[];
    nextCursor: string | null;
  }> {
    const limit = parsePageLimit(query.limit);
    const cursor = decodeCursor(optionalCursor(query.cursor));
    const targetAccountId = optionalAccountId(query.targetAccountId);
    const rows = await this.prisma.staffAuditEvent.findMany({
      where: {
        action: { in: [...accountActions] },
        ...(targetAccountId ? { targetAccountId } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: actionSelect,
    });
    const page = rows.length > limit ? rows.slice(0, limit) : rows;
    const names = await displayNames(
      this.prisma,
      page.map((row) => row.targetAccountId),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toRecord(row, names)),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async detail(id: string): Promise<AccountActionRecord> {
    const row = await this.prisma.staffAuditEvent.findFirst({
      where: { id, action: { in: [...accountActions] } },
      select: actionSelect,
    });
    if (!row) throw new NotFoundException('Account action not found.');
    const names = await displayNames(this.prisma, [row.targetAccountId]);
    return toRecord(row, names);
  }
}

const actionSelect = {
  id: true,
  action: true,
  actorSubjectId: true,
  actorStaffMemberId: true,
  targetAccountId: true,
  previousStatus: true,
  resultingStatus: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.StaffAuditEventSelect;

type ActionRow = {
  id: string;
  action: StaffAuditAction;
  actorSubjectId: string | null;
  actorStaffMemberId: string | null;
  targetAccountId: string | null;
  previousStatus: AccountStatus | null;
  resultingStatus: AccountStatus | null;
  reason: string | null;
  createdAt: Date;
};

function toRecord(row: ActionRow, names: Map<string, string>): AccountActionRecord {
  return {
    id: row.id,
    action: row.action as AccountActionRecord['action'],
    actorSubjectId: row.actorSubjectId,
    actorStaffMemberId: row.actorStaffMemberId,
    targetAccountId: row.targetAccountId,
    targetDisplayName: row.targetAccountId ? names.get(row.targetAccountId) ?? null : null,
    previousStatus: row.previousStatus,
    resultingStatus: row.resultingStatus,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

async function displayNames(
  prisma: PrismaService,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

async function lockActor(tx: Prisma.TransactionClient, issuer: string, subjectId: string) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      status: StaffMembershipStatus;
      role: StaffRole;
      linked_product_user_id: string | null;
    }>
  >`
    SELECT id::text AS id,
           status::text AS status,
           role::text AS role,
           linked_product_user_id::text AS linked_product_user_id
    FROM staff_members
    WHERE issuer = ${issuer}
      AND subject_id = CAST(${subjectId} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    role: row.role,
    subjectId,
    linkedProductUserId: row.linked_product_user_id,
  };
}

async function lockAccount(tx: Prisma.TransactionClient, accountId: string) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; account_status: AccountStatus; deleted_at: Date | null }>
  >`
    SELECT id::text AS id, account_status::text AS account_status, deleted_at
    FROM users
    WHERE id = CAST(${accountId} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.account_status,
    deletedAt: row.deleted_at,
  };
}

function parseStatus(value: unknown): AccountStatus {
  if (value === AccountStatus.ACTIVE || value === AccountStatus.SUSPENDED) return value;
  throw new BadRequestException('Choose an account status.');
}

function parseReason(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Enter a reason.');
  const reason = value.trim();
  if (!reason || reason.length > 500) {
    throw new BadRequestException('Enter a reason of up to 500 characters.');
  }
  return reason;
}

function optionalAccountId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new BadRequestException('That account filter is not valid.');
  }
  return value;
}
