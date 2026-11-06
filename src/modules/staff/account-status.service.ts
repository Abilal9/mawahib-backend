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
import { STAFF_ACCESS_DENIED } from '../../common/auth/admission.codes';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { decodeCursor, encodeCursor, optionalCursor, parsePageLimit } from './admin-read.query';

const ACCOUNT_STATUS_CONFLICT = 'ACCOUNT_STATUS_CONFLICT';
const ACCOUNT_STATUS_INELIGIBLE = 'ACCOUNT_STATUS_INELIGIBLE';

export type AccountStatusOutcome = {
  outcome: 'changed' | 'unchanged';
  accountStatus: AccountStatus;
  previousStatus: AccountStatus;
};

export type AccountActionRecord = {
  id: string;
  action: 'account_suspended' | 'account_restored';
  actorSubjectId: string | null;
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
    actorId: string,
    accountId: string,
    body: Record<string, unknown>,
  ): Promise<AccountStatusOutcome> {
    const requested = parseStatus(body.status);
    const expected = parseStatus(body.expectedStatus);
    const reason = parseReason(body.reason);
    return this.prisma.$transaction((tx) =>
      this.changeInTransaction(tx, actorId, accountId, expected, requested, reason),
    );
  }

  /**
   * Locks the account row and the actor membership, then writes the status
   * and audit event together. A thrown audit error rolls the status back
   * with the transaction. This does not prove PostgreSQL lock timing by itself.
   */
  async changeInTransaction(
    tx: Prisma.TransactionClient,
    actorId: string,
    accountId: string,
    expected: AccountStatus,
    requested: AccountStatus,
    reason: string,
  ): Promise<AccountStatusOutcome> {
    const actor = await lockActor(tx, actorId);
    if (
      !actor ||
      actor.status !== StaffMembershipStatus.active ||
      actor.role !== StaffRole.operator
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
    if (await targetHasStaffMembership(tx, accountId)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: ACCOUNT_STATUS_INELIGIBLE,
        message: 'This account cannot be changed by this action.',
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
        actorSubjectId: actorId,
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

async function lockActor(tx: Prisma.TransactionClient, actorId: string) {
  const rows = await tx.$queryRaw<Array<{ status: StaffMembershipStatus; role: StaffRole }>>`
    SELECT status::text AS status, role::text AS role
    FROM staff_members
    WHERE subject_id = CAST(${actorId} AS uuid)
    FOR UPDATE
  `;
  return rows[0] ?? null;
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

async function targetHasStaffMembership(tx: Prisma.TransactionClient, accountId: string) {
  // This compares a product user id with a staff subject. It is not realm-aware.
  // HTTP staff routes do not reach this service until issuer-aware admission exists.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM staff_members
    WHERE subject_id = CAST(${accountId} AS uuid)
  `;
  return rows.length > 0;
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
