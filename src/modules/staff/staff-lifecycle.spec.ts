import { StaffAuditAction, StaffMembershipStatus } from '@prisma/client';
import { createStaffDirectory } from './staff-lifecycle.directory';
import {
  activateStaff,
  assertLifecycleTargets,
  deactivateStaff,
  inviteStaff,
  permitReenrollment,
  recoverLostFactor,
  resendInvitation,
  readmitStaff,
  sendPasswordSetup,
  type LifecycleOperator,
  type MembershipRow,
  type MembershipStore,
  type StaffDirectory,
} from './staff-lifecycle';

const operator: LifecycleOperator = { unverifiedProcessUser: 'local-operator' };
const issuer = 'https://staff.example/auth/v1';

function directory(partial: Partial<StaffDirectory> = {}): StaffDirectory {
  return {
    findByEmail: async () => null,
    invite: async () => ({ id: '33333333-3333-4333-8333-333333333333' }),
    readIdentity: async () => ({ id: '33333333-3333-4333-8333-333333333333', email: 'person@example.com' }),
    hasVerifiedTotp: async () => true,
    revokeAccess: async () => 'not-revoked',
    removeVerifiedTotp: async () => 'ok',
    sendPasswordRecovery: async () => 'sent',
    ...partial,
  };
}

function memoryStore(seed: MembershipRow[] = []): MembershipStore & { rows: MembershipRow[]; audits: string[] } {
  const rows = [...seed];
  const audits: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(work: () => Promise<T>) => {
    const run = chain.then(work, work);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  return {
    rows,
    audits,
    async latestAction() {
      const last = audits.at(-1);
      if (!last) return null;
      return last.split(':')[0] as StaffAuditAction;
    },
    async find(nextIssuer, subjectId) {
      return rows.find((row) => row.issuer === nextIssuer && row.subjectId === subjectId) ?? null;
    },
    async recordPending(input) {
      const found = rows.find((row) => row.issuer === input.issuer && row.subjectId === input.subjectId);
      if (found) return 'exists';
      rows.push({
        id: `member-${rows.length + 1}`,
        issuer: input.issuer,
        subjectId: input.subjectId,
        status: StaffMembershipStatus.pending,
        invitedEmail: input.email,
      });
      audits.push(`${StaffAuditAction.membership_pending_recorded}:${input.operator.unverifiedProcessUser}`);
      return 'created';
    },
    changeStatus(input) {
      return locked(async () => {
        const active = rows.filter((row) => row.issuer === input.issuer && row.status === StaffMembershipStatus.active);
        const target = rows.find((row) => row.issuer === input.issuer && row.subjectId === input.subjectId);
        if (!target) return 'missing' as const;
        const removesLastActive =
          !input.emergency &&
          target.status === StaffMembershipStatus.active &&
          (input.next === StaffMembershipStatus.inactive || input.next === StaffMembershipStatus.recovery) &&
          active.length === 1 &&
          active[0]?.subjectId === input.subjectId;
        if (removesLastActive) return 'last-operator' as const;
        if (input.onlyFrom && target.status !== input.onlyFrom && target.status !== input.next) {
          return 'blocked' as const;
        }
        if (target.status === input.next) {
          if (input.allowUnchanged || !input.onlyFrom || input.onlyFrom === input.next) return 'unchanged' as const;
          return 'blocked' as const;
        }
        if (input.operator.unverifiedProcessUser === 'audit-fails') return 'audit-failed' as const;
        target.status = input.next;
        audits.push(`${input.action}:${input.operator.unverifiedProcessUser}${input.reason ? `:${input.reason}` : ''}`);
        return 'changed' as const;
      });
    },
  };
}

describe('staff lifecycle commands', () => {
  it('refuses a hosted database or the wrong staff project before any provider call', () => {
    expect(() =>
      assertLifecycleTargets({
        databaseHost: 'db.example.supabase.co',
        expectedDatabaseHost: '127.0.0.1',
        staffProjectRef: 'rjqazivpwvhztgfbqjkq',
        expectedStaffProjectRef: 'rjqazivpwvhztgfbqjkq',
      }),
    ).toThrow(/application database/)
    expect(() =>
      assertLifecycleTargets({
        databaseHost: '127.0.0.1',
        expectedDatabaseHost: '127.0.0.1',
        staffProjectRef: 'other-project',
        expectedStaffProjectRef: 'rjqazivpwvhztgfbqjkq',
      }),
    ).toThrow(/staff-auth project/)
    expect(() =>
      assertLifecycleTargets({
        databaseHost: 'db.example.supabase.co',
        expectedDatabaseHost: 'db.example.supabase.co',
        staffProjectRef: 'rjqazivpwvhztgfbqjkq',
        expectedStaffProjectRef: 'rjqazivpwvhztgfbqjkq',
      }),
    ).not.toThrow()
  })

  it('records a pending membership from a new invitation and does not invite twice', async () => {
    const invites: string[] = [];
    const store = memoryStore();
    const first = await inviteStaff({
      issuer,
      email: 'person@example.com',
      send: true,
      operator,
      directory: directory({
        invite: async (email) => {
          invites.push(email);
          return { id: '33333333-3333-4333-8333-333333333333' };
        },
      }),
      store,
    });
    const second = await inviteStaff({
      issuer,
      email: 'person@example.com',
      send: true,
      operator,
      directory: directory({
        findByEmail: async () => ({ id: '33333333-3333-4333-8333-333333333333' }),
        invite: async () => {
          throw new Error('should not invite again');
        },
      }),
      store,
    });
    expect(first).toEqual({ outcome: 'pending-recorded', subjectId: '33333333-3333-4333-8333-333333333333', invited: true });
    expect(second).toMatchObject({ outcome: 'pending-recorded', invited: false });
    expect(invites).toEqual(['person@example.com']);
    expect(store.rows).toHaveLength(1);
  });

  it('retries a failed membership write without sending another invitation', async () => {
    const invites: string[] = []
    const directory = {
      findByEmail: async () => ({ id: '33333333-3333-4333-8333-333333333333' }),
      invite: async (email: string) => {
        invites.push(email)
        return { id: '33333333-3333-4333-8333-333333333333' } as const
      },
      readIdentity: async () => ({ id: '33333333-3333-4333-8333-333333333333', email: 'person@example.com' }),
      hasVerifiedTotp: async () => true as const,
      revokeAccess: async () => 'not-revoked' as const,
      removeVerifiedTotp: async () => 'ok' as const,
      sendPasswordRecovery: async () => 'sent' as const,
    }
    const failing = memoryStore()
    failing.recordPending = async () => {
      throw new Error('database down')
    }
    const failed = await inviteStaff({
      issuer,
      email: 'person@example.com',
      send: true,
      operator,
      directory,
      store: failing,
    })
    const store = memoryStore()
    const retried = await inviteStaff({
      issuer,
      email: 'person@example.com',
      send: true,
      operator,
      directory,
      store,
    })
    expect(failed.outcome).toBe('provider-created-membership-missing')
    expect(retried).toMatchObject({ outcome: 'pending-recorded', invited: false })
    expect(invites).toEqual([])
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending)
  })

  it('reports a provider user without granting access when the membership write fails', async () => {
    const result = await inviteStaff({
      issuer,
      email: 'person@example.com',
      send: true,
      operator,
      directory: directory(),
      store: {
        find: async () => null,
        latestAction: async () => null,
        recordPending: async () => {
          throw new Error('database down');
        },
        changeStatus: async () => 'missing',
      },
    });
    expect(result).toEqual({
      outcome: 'provider-created-membership-missing',
      subjectId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('refuses activation without confirmation or a verified factor', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.pending, invitedEmail: 'person@example.com' },
    ]);
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: false,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store,
      }),
    ).toEqual({ outcome: 'not-confirmed' });
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory({ hasVerifiedTotp: async () => false }),
        store,
      }),
    ).toEqual({ outcome: 'factor-missing' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending);
    expect(
      await activateStaff({
        issuer: 'https://product.example/auth/v1',
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store,
      }),
    ).toEqual({ outcome: 'identity-missing' });
  });

  it('activates only the confirmed issuer subject and keeps a failed audit inactive', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.pending, invitedEmail: 'person@example.com' },
    ]);
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store,
      }),
    ).toEqual({ outcome: 'activated', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(store.audits.at(-1)).toContain(StaffAuditAction.membership_activated);
    await expect(
      deactivateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        emergency: true,
        operator: { unverifiedProcessUser: 'audit-fails' },
        directory: directory(),
        store,
      }),
    ).rejects.toThrow('deactivation audit failed');
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.active);
  });

  it('disables membership before provider cleanup and protects the last operator', async () => {
    const calls: string[] = [];
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
      { id: 'member-2', issuer, subjectId: '44444444-4444-4444-8444-444444444444', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
    ]);
    const removed = await deactivateStaff({
      issuer,
      subjectId: '33333333-3333-4333-8333-333333333333',
      emergency: false,
      operator,
      directory: directory({
        revokeAccess: async (subjectId) => {
          calls.push(`${store.rows.find((row) => row.subjectId === subjectId)?.status}:${subjectId}`);
          return 'not-revoked';
        },
      }),
      store,
    });
    expect(removed).toMatchObject({ outcome: 'deactivated', access: 'removed', providerSession: 'not-revoked', factorCleanup: 'unchanged' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.inactive);
    expect(calls).toEqual(['inactive:33333333-3333-4333-8333-333333333333']);
    expect(
      await deactivateStaff({
        issuer,
        subjectId: '44444444-4444-4444-8444-444444444444',
        emergency: false,
        operator,
        directory: directory(),
        store,
      }),
    ).toEqual({ outcome: 'last-operator', access: 'unchanged' });
    expect(
      await deactivateStaff({
        issuer,
        subjectId: '44444444-4444-4444-8444-444444444444',
        emergency: true,
        operator,
        directory: directory(),
        store,
      }),
    ).toMatchObject({ outcome: 'deactivated', access: 'removed', providerSession: 'not-revoked' });
    expect(store.rows.every((row) => row.status === StaffMembershipStatus.inactive)).toBe(true);
  });

  it('does not let two routine removals both pass the last-operator check', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
      { id: 'member-2', issuer, subjectId: '44444444-4444-4444-8444-444444444444', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
    ]);
    const [first, second] = await Promise.all([
      deactivateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        emergency: false,
        operator,
        directory: directory(),
        store,
      }),
      deactivateStaff({
        issuer,
        subjectId: '44444444-4444-4444-8444-444444444444',
        emergency: false,
        operator,
        directory: directory(),
        store,
      }),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['deactivated', 'last-operator']);
    expect(store.rows.filter((row) => row.status === StaffMembershipStatus.active)).toHaveLength(1);
  });

  it('retries a known subject without inviting and does not reactivate an inactive membership', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.inactive, invitedEmail: 'person@example.com' },
    ]);
    const invites: string[] = [];
    const result = await inviteStaff({
      issuer,
      email: 'person@example.com',
      send: true,
      knownSubjectId: '33333333-3333-4333-8333-333333333333',
      operator,
      directory: directory({
        invite: async (email) => {
          invites.push(email);
          return { id: '33333333-3333-4333-8333-333333333333' };
        },
      }),
      store,
    });
    expect(result).toEqual({
      outcome: 'membership-exists',
      subjectId: '33333333-3333-4333-8333-333333333333',
      status: StaffMembershipStatus.inactive,
    });
    expect(invites).toEqual([]);
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store,
      }),
    ).toEqual({ outcome: 'not-pending' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.inactive);
  });

  it('removes a verified factor only after membership is disabled', async () => {
    const calls: string[] = [];
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
      { id: 'member-2', issuer, subjectId: '44444444-4444-4444-8444-444444444444', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
    ]);
    const recovered = await recoverLostFactor({
      issuer,
      subjectId: '33333333-3333-4333-8333-333333333333',
      emergency: false,
      confirmed: true,
      operator,
      directory: directory({
        removeVerifiedTotp: async (subjectId) => {
          calls.push(store.rows.find((row) => row.subjectId === subjectId)?.status ?? 'missing');
          return 'unavailable';
        },
      }),
      store,
    });
    expect(recovered).toMatchObject({ outcome: 'recovery-partial', access: 'removed', factorCleanup: 'incomplete' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.recovery);
    expect(calls).toEqual(['recovery']);
  });

  it('does not return an invitation link and does not invite a user it could not search', async () => {
    const admin = {
      listUsers: async () => ({ data: { users: [] }, error: { message: 'down' } }),
      inviteUserByEmail: async () => {
        throw new Error('should not invite');
      },
      getUserById: async () => ({
        data: { user: { id: '33333333-3333-4333-8333-333333333333', email: 'person@example.com' } },
        error: null,
      }),
      mfa: {
        listFactors: async () => ({ data: { factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] }, error: null }),
        deleteFactor: async () => ({ error: null }),
      },
    };
    const staff = createStaffDirectory(admin, 'https://admin.mawahib.io');
    await expect(staff.findByEmail('person@example.com')).resolves.toBe('unavailable');
    await expect(staff.hasVerifiedTotp('33333333-3333-4333-8333-333333333333')).resolves.toBe(true);
    await expect(staff.revokeAccess('33333333-3333-4333-8333-333333333333')).resolves.toBe('not-revoked');
    await expect(staff.readIdentity('33333333-3333-4333-8333-333333333333')).resolves.toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      email: 'person@example.com',
    });
    expect(JSON.stringify(await staff.hasVerifiedTotp('33333333-3333-4333-8333-333333333333'))).not.toContain('factor');
  });

  it('permits re-enrollment only after recovery cleanup and still refuses inactive activation', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
      { id: 'member-2', issuer, subjectId: '44444444-4444-4444-8444-444444444444', status: StaffMembershipStatus.active, invitedEmail: 'other@example.com' },
    ]);
    const recovered = await recoverLostFactor({
      issuer,
      subjectId: '33333333-3333-4333-8333-333333333333',
      emergency: false,
      confirmed: true,
      operator,
      directory: directory({ hasVerifiedTotp: async () => false, removeVerifiedTotp: async () => 'ok' }),
      store,
    });
    expect(recovered).toMatchObject({ outcome: 'recovery-disabled', factorCleanup: 'removed', providerSession: 'not-revoked' });
    expect(
      await permitReenrollment({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        operator,
        directory: directory({ hasVerifiedTotp: async () => true }),
        store,
      }),
    ).toEqual({ outcome: 'cleanup-incomplete' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.recovery);
    expect(
      await permitReenrollment({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        operator,
        directory: directory({ hasVerifiedTotp: async () => false }),
        store,
      }),
    ).toEqual({ outcome: 'reenrollment-permitted', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending);
    await deactivateStaff({
      issuer,
      subjectId: '44444444-4444-4444-8444-444444444444',
      emergency: true,
      operator,
      directory: directory(),
      store,
    });
    expect(
      await permitReenrollment({
        issuer,
        subjectId: '44444444-4444-4444-8444-444444444444',
        confirmed: true,
        operator,
        directory: directory({ hasVerifiedTotp: async () => false }),
        store,
      }),
    ).toEqual({ outcome: 'not-in-recovery' });
    expect(store.rows[1]?.status).toBe(StaffMembershipStatus.inactive);
  });

  it('stops activation when the provider email changed and records an explicit acknowledgement', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.pending, invitedEmail: 'person@example.com' },
    ]);
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory({
          readIdentity: async () => ({ id: '33333333-3333-4333-8333-333333333333', email: 'other@example.com' }),
        }),
        store,
      }),
    ).toEqual({ outcome: 'identity-changed' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending);
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: true,
        operator,
        directory: directory({
          readIdentity: async () => ({ id: '33333333-3333-4333-8333-333333333333', email: 'other@example.com' }),
        }),
        store,
      }),
    ).toEqual({ outcome: 'activated', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(store.audits.at(-1)).toContain('identity-change-acknowledged');
    expect(JSON.stringify(store.audits)).not.toContain('other@example.com');
  });

  it('does not send again after an uncertain invitation until an explicit resend', async () => {
    const invites: string[] = [];
    const staff = directory({
      invite: async (email) => {
        invites.push(email);
        return 'uncertain';
      },
    });
    expect(
      await inviteStaff({
        issuer,
        email: 'person@example.com',
        send: true,
        operator,
        directory: staff,
        store: memoryStore(),
      }),
    ).toEqual({ outcome: 'uncertain' });
    expect(
      await inviteStaff({
        issuer,
        email: 'person@example.com',
        send: false,
        operator,
        directory: staff,
        store: memoryStore(),
      }),
    ).toEqual({ outcome: 'unresolved' });
    expect(invites).toEqual(['person@example.com']);
    const pending = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.pending, invitedEmail: 'person@example.com' },
    ]);
    expect(
      await resendInvitation({
        issuer,
        email: 'person@example.com',
        subjectId: '33333333-3333-4333-8333-333333333333',
        acknowledgeIdentityChange: false,
        operator,
        directory: directory({
          invite: async (email) => {
            invites.push(email);
            return 'already-exists';
          },
        }),
        store: pending,
      }),
    ).toEqual({ outcome: 'not-delivered', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(pending.rows).toHaveLength(1);
  });

  it('sends one password-setup email for the same pending identity and does not activate it', async () => {
    const sends: string[] = [];
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.pending, invitedEmail: 'person@example.com' },
    ]);
    const sent = await sendPasswordSetup({
      issuer,
      email: 'person@example.com',
      subjectId: '33333333-3333-4333-8333-333333333333',
      send: true,
      acknowledgeIdentityChange: false,
      operator,
      directory: directory({
        sendPasswordRecovery: async (email) => {
          sends.push(email);
          return 'uncertain';
        },
      }),
      store,
    });
    expect(sent).toEqual({ outcome: 'uncertain' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending);
    const retry = await sendPasswordSetup({
      issuer,
      email: 'person@example.com',
      subjectId: '33333333-3333-4333-8333-333333333333',
      send: false,
      acknowledgeIdentityChange: false,
      operator,
      directory: directory({
        sendPasswordRecovery: async () => {
          sends.push('again');
          return 'sent';
        },
      }),
      store,
    });
    expect(retry).toEqual({ outcome: 'not-sent' });
    expect(sends).toEqual(['person@example.com']);
    expect(
      await sendPasswordSetup({
        issuer,
        email: 'other@example.com',
        subjectId: '33333333-3333-4333-8333-333333333333',
        send: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store,
      }),
    ).toEqual({ outcome: 'identity-changed' });
    const targets: string[] = [];
    const acknowledged = await sendPasswordSetup({
      issuer,
      email: 'person@example.com',
      subjectId: '33333333-3333-4333-8333-333333333333',
      send: true,
      acknowledgeIdentityChange: true,
      operator,
      directory: directory({
        readIdentity: async () => ({ id: '33333333-3333-4333-8333-333333333333', email: 'current@example.com' }),
        sendPasswordRecovery: async (email) => {
          targets.push(email);
          return 'sent';
        },
      }),
      store,
    });
    expect(acknowledged).toEqual({ outcome: 'sent', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(targets).toEqual(['current@example.com']);
    expect(JSON.stringify(acknowledged)).not.toContain('current@example.com');
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending);
  });

  it('readmits an inactive operator to pending and refuses recovery or an emergency removal that still has a factor', async () => {
    const ordinary = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.inactive, invitedEmail: 'person@example.com' },
    ]);
    ordinary.audits.push(`${StaffAuditAction.membership_deactivated}:local-operator`);
    expect(
      await readmitStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        reason: 'Returned from leave',
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store: ordinary,
      }),
    ).toEqual({ outcome: 'readmitted', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(ordinary.rows[0]?.status).toBe(StaffMembershipStatus.pending);
    expect(ordinary.audits.at(-1)).toContain(StaffAuditAction.membership_readmitted);
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: directory({ hasVerifiedTotp: async () => false }),
        store: ordinary,
      }),
    ).toEqual({ outcome: 'factor-missing' });

    const recovering = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.recovery, invitedEmail: 'person@example.com' },
    ]);
    expect(
      await readmitStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        reason: 'Wrong operation',
        acknowledgeIdentityChange: false,
        operator,
        directory: directory(),
        store: recovering,
      }),
    ).toEqual({ outcome: 'use-recovery' });
    expect(recovering.rows[0]?.status).toBe(StaffMembershipStatus.recovery);

    const emergency = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.inactive, invitedEmail: 'person@example.com' },
    ]);
    emergency.audits.push(`${StaffAuditAction.membership_emergency_deactivated}:local-operator`);
    expect(
      await readmitStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        reason: 'Too soon',
        acknowledgeIdentityChange: false,
        operator,
        directory: directory({ hasVerifiedTotp: async () => true }),
        store: emergency,
      }),
    ).toEqual({ outcome: 'cleanup-required' });
    expect(emergency.rows[0]?.status).toBe(StaffMembershipStatus.inactive);
    await expect(
      readmitStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        reason: 'Audit must hold',
        acknowledgeIdentityChange: false,
        operator: { unverifiedProcessUser: 'audit-fails' },
        directory: directory({ hasVerifiedTotp: async () => false }),
        store: emergency,
      }),
    ).rejects.toThrow('readmission audit failed');
    expect(emergency.rows[0]?.status).toBe(StaffMembershipStatus.inactive);
  });

  it('recovers an emergency-deactivated operator without restoring access', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.active, invitedEmail: 'person@example.com' },
    ]);
    let verified = true;
    let removals = 0;
    const staff = directory({
      hasVerifiedTotp: async () => verified,
      removeVerifiedTotp: async () => {
        removals += 1;
        if (removals === 1) return 'unavailable';
        verified = false;
        return 'ok';
      },
    });
    await deactivateStaff({
      issuer,
      subjectId: '33333333-3333-4333-8333-333333333333',
      emergency: true,
      operator,
      directory: staff,
      store,
    });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.inactive);
    expect(
      await recoverLostFactor({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        emergency: false,
        confirmed: true,
        operator,
        directory: staff,
        store,
      }),
    ).toMatchObject({ outcome: 'not-recoverable', status: StaffMembershipStatus.inactive });
    expect(
      await readmitStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        reason: 'Skip cleanup',
        acknowledgeIdentityChange: false,
        operator,
        directory: staff,
        store,
      }),
    ).toEqual({ outcome: 'cleanup-required' });
    const failed = await recoverLostFactor({
      issuer,
      subjectId: '33333333-3333-4333-8333-333333333333',
      emergency: true,
      confirmed: true,
      operator,
      directory: staff,
      store,
    });
    expect(failed).toMatchObject({ outcome: 'recovery-partial', access: 'removed', factorCleanup: 'incomplete' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.recovery);
    const retried = await recoverLostFactor({
      issuer,
      subjectId: '33333333-3333-4333-8333-333333333333',
      emergency: true,
      confirmed: true,
      operator,
      directory: staff,
      store,
    });
    expect(retried).toMatchObject({ outcome: 'recovery-disabled', factorCleanup: 'removed', providerSession: 'not-revoked' });
    expect(store.audits.filter((item) => item.startsWith(StaffAuditAction.membership_factor_recovery_started))).toHaveLength(1);
    expect(
      await permitReenrollment({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        operator,
        directory: staff,
        store,
      }),
    ).toEqual({ outcome: 'reenrollment-permitted', subjectId: '33333333-3333-4333-8333-333333333333' });
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.pending);
    verified = true;
    expect(
      await activateStaff({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
        acknowledgeIdentityChange: false,
        operator,
        directory: staff,
        store,
      }),
    ).toEqual({ outcome: 'activated', subjectId: '33333333-3333-4333-8333-333333333333' });
  });

  it('keeps an emergency-deactivated membership inactive when the recovery audit fails', async () => {
    const store = memoryStore([
      { id: 'member-1', issuer, subjectId: '33333333-3333-4333-8333-333333333333', status: StaffMembershipStatus.inactive, invitedEmail: 'person@example.com' },
    ]);
    store.audits.push(`${StaffAuditAction.membership_emergency_deactivated}:local-operator`);
    const ordinary = memoryStore([
      { id: 'member-2', issuer, subjectId: '44444444-4444-4444-8444-444444444444', status: StaffMembershipStatus.inactive, invitedEmail: 'other@example.com' },
    ]);
    ordinary.audits.push(`${StaffAuditAction.membership_deactivated}:local-operator`);
    expect(
      await recoverLostFactor({
        issuer,
        subjectId: '44444444-4444-4444-8444-444444444444',
        emergency: true,
        confirmed: true,
        operator,
        directory: directory(),
        store: ordinary,
      }),
    ).toMatchObject({ outcome: 'not-recoverable' });
    await expect(
      recoverLostFactor({
        issuer,
        subjectId: '33333333-3333-4333-8333-333333333333',
        emergency: true,
        confirmed: true,
        operator: { unverifiedProcessUser: 'audit-fails' },
        directory: directory(),
        store,
      }),
    ).rejects.toThrow('recovery audit failed');
    expect(store.rows[0]?.status).toBe(StaffMembershipStatus.inactive);
  });
});
