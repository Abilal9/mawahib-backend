import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AuthSubjectKind,
  StaffAuditAction,
  StaffMembershipStatus,
  StaffRole,
} from '@prisma/client';
import { STAFF_PRODUCT_SEPARATION_CODE } from '../../common/auth/admission.codes';
import { StaffMembershipService } from './staff-membership.service';

const SUBJECT = '33333333-3333-4333-8333-333333333333';

type Reservation = { subjectId: string; kind: AuthSubjectKind };
type Member = {
  subjectId: string;
  role: StaffRole;
  status: StaffMembershipStatus;
};

/**
 * In-memory stand-in. A thrown callback restores the maps.
 * This does not prove PostgreSQL locking or isolation.
 */
function fakePrisma() {
  const reservations = new Map<string, Reservation>();
  const members = new Map<string, Member>();
  const users = new Set<string>();
  const audits: { action: StaffAuditAction; targetSubjectId: string }[] = [];
  let failAudit = false;

  const snapshot = () => ({
    reservations: new Map(reservations),
    members: new Map(members),
    users: new Set(users),
    audits: [...audits],
  });
  const restore = (saved: ReturnType<typeof snapshot>) => {
    reservations.clear();
    saved.reservations.forEach((value, key) => reservations.set(key, value));
    members.clear();
    saved.members.forEach((value, key) => members.set(key, value));
    users.clear();
    saved.users.forEach((id) => users.add(id));
    audits.splice(0, audits.length, ...saved.audits);
  };

  const unique = () => {
    const error = new Error('unique') as Error & { code: string };
    error.code = 'P2002';
    return error;
  };

  const tx = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.has(where.id) ? { id: where.id } : null,
    },
    authSubjectReservation: {
      findUnique: async ({ where }: { where: { subjectId: string } }) =>
        reservations.get(where.subjectId) ?? null,
      createMany: async ({
        data,
      }: {
        data: Reservation[];
        skipDuplicates?: boolean;
      }) => {
        const row = data[0];
        if (!row) return { count: 0 };
        if (reservations.has(row.subjectId)) return { count: 0 };
        reservations.set(row.subjectId, row);
        return { count: 1 };
      },
    },
    staffMember: {
      findUnique: async ({ where }: { where: { subjectId: string } }) =>
        members.get(where.subjectId) ?? null,
      create: async ({
        data,
      }: {
        data: { subjectId: string; role: StaffRole; status: StaffMembershipStatus };
      }) => {
        const row = {
          subjectId: data.subjectId,
          role: data.role,
          status: data.status,
        };
        members.set(data.subjectId, row);
        return row;
      },
    },
    staffAuditEvent: {
      create: async ({
        data,
      }: {
        data: { action: StaffAuditAction; targetSubjectId: string };
      }) => {
        if (failAudit) throw new Error('audit failed');
        audits.push(data);
        return data;
      },
    },
  };

  return {
    prisma: {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => {
        const saved = snapshot();
        try {
          return await fn(tx);
        } catch (err) {
          restore(saved);
          throw err;
        }
      },
      staffMember: tx.staffMember,
    },
    reservations,
    members,
    users,
    audits,
    setFailAudit(value: boolean) {
      failAudit = value;
    },
  };
}

describe('staff and product subject reservation', () => {
  const actor = { unverifiedProcessUser: 'local-tester' };

  it('creates one pending membership and one audit row', async () => {
    const db = fakePrisma();
    const service = new StaffMembershipService(db.prisma as never);
    const first = await service.provisionPending(SUBJECT, actor);
    const second = await service.provisionPending(SUBJECT, actor);
    expect(first).toEqual({ created: true });
    expect(second).toEqual({ created: false, unchanged: 'pending' });
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]?.action).toBe(
      StaffAuditAction.membership_pending_recorded,
    );
    expect(db.members.get(SUBJECT)?.status).toBe(StaffMembershipStatus.pending);
    expect(db.reservations.get(SUBJECT)?.kind).toBe(AuthSubjectKind.staff);
  });

  it('refuses a subject that already has a product user', async () => {
    const db = fakePrisma();
    db.users.add(SUBJECT);
    const service = new StaffMembershipService(db.prisma as never);
    await expect(service.provisionPending(SUBJECT, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.members.size).toBe(0);
    expect(db.audits).toHaveLength(0);
  });

  it('rolls the membership back when the audit insert fails', async () => {
    const db = fakePrisma();
    db.setFailAudit(true);
    const service = new StaffMembershipService(db.prisma as never);
    await expect(service.provisionPending(SUBJECT, actor)).rejects.toThrow(
      'audit failed',
    );
    expect(db.members.size).toBe(0);
    expect(db.reservations.size).toBe(0);
    expect(db.audits).toHaveLength(0);
  });

  it.each([
    StaffMembershipStatus.pending,
    StaffMembershipStatus.active,
    StaffMembershipStatus.inactive,
  ])('blocks product bootstrap for a %s staff reservation', async (status) => {
    const db = fakePrisma();
    const service = new StaffMembershipService(db.prisma as never);
    await service.provisionPending(SUBJECT, actor);
    const member = db.members.get(SUBJECT);
    if (member) member.status = status;
    await expect(service.holdProductSubject(SUBJECT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    try {
      await service.holdProductSubject(SUBJECT);
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: STAFF_PRODUCT_SEPARATION_CODE,
      });
    }
  });

  it('allows a repeated product reservation for an existing subject', async () => {
    const db = fakePrisma();
    const service = new StaffMembershipService(db.prisma as never);
    await service.holdProductSubject(SUBJECT);
    await expect(service.holdProductSubject(SUBJECT)).resolves.toBeUndefined();
    expect(db.reservations.get(SUBJECT)?.kind).toBe(AuthSubjectKind.product);
  });

  it('a second claim for the same subject keeps only the first kind', async () => {
    const db = fakePrisma();
    const service = new StaffMembershipService(db.prisma as never);
    await service.provisionPending(SUBJECT, actor);
    await expect(service.holdProductSubject(SUBJECT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.reservations.get(SUBJECT)?.kind).toBe(AuthSubjectKind.staff);
    expect(db.members.has(SUBJECT)).toBe(true);

    const other = '55555555-5555-4555-8555-555555555555';
    await service.holdProductSubject(other);
    await expect(service.provisionPending(other, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.reservations.get(other)?.kind).toBe(AuthSubjectKind.product);
    expect(db.members.has(other)).toBe(false);
  });
});
