import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountStatus, StaffAuditAction, StaffMembershipStatus, StaffRole } from '@prisma/client';
import { AccountStatusService } from './account-status.service';

/**
 * Serializes transactions and restores their writes on failure.
 * This is not evidence of PostgreSQL row locks or isolation.
 */
function createFakeDb() {
  const state = {
    account: {
      id: '44444444-4444-4444-8444-444444444444',
      status: AccountStatus.ACTIVE,
      deletedAt: null as Date | null,
    } as { id: string; status: AccountStatus; deletedAt: Date | null } | null,
    actor: {
      id: '66666666-6666-4666-8666-666666666666',
      issuer: 'https://staff-test.supabase.co/auth/v1',
      subjectId: '22222222-2222-4222-8222-222222222222',
      status: StaffMembershipStatus.active,
      role: StaffRole.operator,
      linkedProductUserId: null as string | null,
    } as {
      id: string;
      issuer: string;
      subjectId: string;
      status: StaffMembershipStatus;
      role: StaffRole;
      linkedProductUserId: string | null;
    } | null,
    failAudit: false,
    audits: [] as Array<Record<string, unknown>>,
  };
  let chain = Promise.resolve();

  function snapshot() {
    return {
      account: state.account ? { ...state.account } : null,
      audits: state.audits.map((row) => ({ ...row })),
    };
  }

  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = Array.from(strings ?? []).join(' ');
      if (sql.includes('FROM staff_members')) {
        const issuer = values[0];
        const subject = values[1];
        if (!state.actor || issuer !== state.actor.issuer || subject !== state.actor.subjectId) {
          return [];
        }
        return [{
          id: state.actor.id,
          status: state.actor.status,
          role: state.actor.role,
          linked_product_user_id: state.actor.linkedProductUserId,
        }];
      }
      if (sql.includes('FROM users')) {
        return state.account
          ? [{ id: state.account.id, account_status: state.account.status, deleted_at: state.account.deletedAt }]
          : [];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    user: {
      async updateMany({ where, data }: { where: { accountStatus: AccountStatus; deletedAt: null }; data: { accountStatus: AccountStatus } }) {
        if (!state.account || state.account.deletedAt || state.account.status !== where.accountStatus) {
          return { count: 0 };
        }
        state.account = { ...state.account, status: data.accountStatus };
        return { count: 1 };
      },
    },
    staffAuditEvent: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (state.failAudit) throw new Error('audit failed');
        state.audits.push(data);
        return data;
      },
    },
  };

  return {
    state,
    prisma: {
      async $transaction(fn: (client: typeof tx) => Promise<unknown>) {
        const run = chain.then(async () => {
          const saved = snapshot();
          try {
            return await fn(tx);
          } catch (error) {
            state.account = saved.account;
            state.audits = saved.audits;
            throw error;
          }
        });
        chain = run.then(() => undefined, () => undefined);
        return run;
      },
      staffAuditEvent: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
}

const ACTOR = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const MEMBER = '66666666-6666-4666-8666-666666666666';
const ISSUER = 'https://staff-test.supabase.co/auth/v1';

function actor() {
  return { issuer: ISSUER, subjectId: ACTOR };
}

function body(status: AccountStatus, expected: AccountStatus, reason = '  Needed for review  ') {
  return { status, expectedStatus: expected, reason };
}

describe('AccountStatusService', () => {
  it('suspends once, restores, and does not repeat an unchanged status', async () => {
    const db = createFakeDb();
    const service = new AccountStatusService(db.prisma as never);
    const suspended = await service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE));
    expect(suspended).toEqual({
      outcome: 'changed',
      accountStatus: AccountStatus.SUSPENDED,
      previousStatus: AccountStatus.ACTIVE,
    });
    expect(db.state.audits).toHaveLength(1);
    expect(db.state.audits[0]).toMatchObject({
      action: StaffAuditAction.account_suspended,
      actorSubjectId: ACTOR,
      actorStaffMemberId: MEMBER,
      targetAccountId: ACCOUNT,
      previousStatus: AccountStatus.ACTIVE,
      resultingStatus: AccountStatus.SUSPENDED,
      reason: 'Needed for review',
      unverifiedProcessUser: null,
    });

    const again = await service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE));
    expect(again.outcome).toBe('unchanged');
    expect(db.state.audits).toHaveLength(1);

    const restored = await service.change(actor(), ACCOUNT, body(AccountStatus.ACTIVE, AccountStatus.SUSPENDED, 'Review finished'));
    expect(restored.outcome).toBe('changed');
    expect(db.state.account?.status).toBe(AccountStatus.ACTIVE);
    expect(db.state.audits[1]).toMatchObject({ action: StaffAuditAction.account_restored });
  });

  it('rejects a missing, blank, or overlong reason before writing', async () => {
    const db = createFakeDb();
    const service = new AccountStatusService(db.prisma as never);
    await expect(service.change(actor(), ACCOUNT, { status: 'SUSPENDED', expectedStatus: 'ACTIVE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE, '   '))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE, 'x'.repeat(501)))).rejects.toBeInstanceOf(BadRequestException);
    expect(db.state.account?.status).toBe(AccountStatus.ACTIVE);
    expect(db.state.audits).toHaveLength(0);
  });

  it('rejects an explicit self link and still changes another employee account', async () => {
    const self = createFakeDb();
    if (self.state.actor) self.state.actor.linkedProductUserId = ACCOUNT;
    await expect(
      new AccountStatusService(self.prisma as never).change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE)),
    ).rejects.toMatchObject({ response: { code: 'SELF_ACTION_FORBIDDEN' } });
    expect(self.state.account?.status).toBe(AccountStatus.ACTIVE);
    expect(self.state.audits).toHaveLength(0);

    const other = createFakeDb();
    if (other.state.actor) other.state.actor.linkedProductUserId = '77777777-7777-4777-8777-777777777777';
    const changed = await new AccountStatusService(other.prisma as never).change(
      actor(),
      ACCOUNT,
      body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE),
    );
    expect(changed.outcome).toBe('changed');
    expect(other.state.account?.status).toBe(AccountStatus.SUSPENDED);
  });

  it('does not infer a self-action when the explicit link is absent', async () => {
    const db = createFakeDb();
    const changed = await new AccountStatusService(db.prisma as never).change(actor(), ACCOUNT, {
      ...body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE),
      issuer: 'https://product-test.supabase.co/auth/v1',
      email: 'same.person@example.com',
    });
    expect(changed.outcome).toBe('changed');
    expect(db.state.audits[0]).toMatchObject({ actorStaffMemberId: MEMBER, actorSubjectId: ACTOR });
  });

  it('rolls back the status when the audit event fails', async () => {
    const db = createFakeDb();
    db.state.failAudit = true;
    const service = new AccountStatusService(db.prisma as never);
    await expect(service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE))).rejects.toThrow('audit failed');
    expect(db.state.account?.status).toBe(AccountStatus.ACTIVE);
    expect(db.state.audits).toHaveLength(0);
  });

  it('does not write when the actor membership is inactive or belongs to another issuer', async () => {
    const inactive = createFakeDb();
    if (inactive.state.actor) inactive.state.actor.status = StaffMembershipStatus.inactive;
    await expect(new AccountStatusService(inactive.prisma as never).change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE))).rejects.toBeInstanceOf(ForbiddenException);
    expect(inactive.state.account?.status).toBe(AccountStatus.ACTIVE);

    const otherIssuer = createFakeDb();
    await expect(
      new AccountStatusService(otherIssuer.prisma as never).change(
        { issuer: 'https://product-test.supabase.co/auth/v1', subjectId: ACTOR },
        ACCOUNT,
        body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(otherIssuer.state.audits).toHaveLength(0);
  });

  it('conflicts when the confirmed status is no longer current and the request is not a repeat', async () => {
    const db = createFakeDb();
    db.state.account = { id: ACCOUNT, status: AccountStatus.SUSPENDED, deletedAt: null };
    await expect(
      new AccountStatusService(db.prisma as never).change(actor(), ACCOUNT, body(AccountStatus.ACTIVE, AccountStatus.ACTIVE)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.audits).toHaveLength(0);
  });

  it('serializes identical requests into one transition and applies a later opposing request', async () => {
    const db = createFakeDb();
    const service = new AccountStatusService(db.prisma as never);
    const [first, second] = await Promise.all([
      service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE)),
      service.change(actor(), ACCOUNT, body(AccountStatus.SUSPENDED, AccountStatus.ACTIVE)),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['changed', 'unchanged']);
    expect(db.state.audits).toHaveLength(1);

    const restored = await service.change(actor(), ACCOUNT, body(AccountStatus.ACTIVE, AccountStatus.SUSPENDED, 'Opposite action'));
    expect(restored.outcome).toBe('changed');
    expect(db.state.account?.status).toBe(AccountStatus.ACTIVE);
    expect(db.state.audits).toHaveLength(2);
  });

  it('returns account-status history without provisioning fields', async () => {
    const db = createFakeDb();
    const createdAt = new Date('2026-03-01T00:00:00.000Z');
    db.prisma.staffAuditEvent.findMany.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        action: StaffAuditAction.account_suspended,
        actorSubjectId: ACTOR,
        actorStaffMemberId: MEMBER,
        targetAccountId: ACCOUNT,
        previousStatus: AccountStatus.ACTIVE,
        resultingStatus: AccountStatus.SUSPENDED,
        reason: 'Needed for review',
        createdAt,
      },
    ]);
    db.prisma.user.findMany.mockResolvedValue([{ id: ACCOUNT, displayName: 'Ada' }]);
    const page = await new AccountStatusService(db.prisma as never).list({ targetAccountId: ACCOUNT });
    expect(page.items[0]).toEqual({
      id: '55555555-5555-4555-8555-555555555555',
      action: 'account_suspended',
      actorSubjectId: ACTOR,
      actorStaffMemberId: MEMBER,
      targetAccountId: ACCOUNT,
      targetDisplayName: 'Ada',
      previousStatus: AccountStatus.ACTIVE,
      resultingStatus: AccountStatus.SUSPENDED,
      reason: 'Needed for review',
      createdAt: createdAt.toISOString(),
    });
    expect(page.items[0]).not.toHaveProperty('unverifiedProcessUser');
    const args = db.prisma.staffAuditEvent.findMany.mock.calls[0][0];
    expect(args.where.action.in).toEqual([
      StaffAuditAction.account_suspended,
      StaffAuditAction.account_restored,
    ]);
    expect(args.where.targetAccountId).toBe(ACCOUNT);
    expect(args.select).not.toHaveProperty('unverifiedProcessUser');
  });
});
