import {
  Prisma,
  StaffAuditAction,
  StaffMembershipStatus,
  StaffRole,
  type PrismaClient,
} from '@prisma/client';
import type { LifecycleOperator, MembershipStore } from './staff-lifecycle';

type LifecycleDb = Pick<PrismaClient, '$transaction' | 'staffMember' | 'staffAuditEvent'>;

/**
 * Database half of an operator command.
 * The caller must finish provider checks before activation and start provider cleanup only after deactivation commits.
 */
export function createLifecycleStore(prisma: LifecycleDb): MembershipStore {
  return {
    find(issuer, subjectId) {
      return prisma.staffMember.findFirst({
        where: { issuer, subjectId },
        select: { id: true, issuer: true, subjectId: true, status: true, invitedEmail: true },
      });
    },
    async recordPending(input) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.staffMember.create({
            data: {
              issuer: input.issuer,
              subjectId: input.subjectId,
              role: StaffRole.operator,
              status: StaffMembershipStatus.pending,
              invitedEmail: input.email,
            },
          });
          await writeAudit(tx, {
            action: StaffAuditAction.membership_pending_recorded,
            subjectId: input.subjectId,
            operator: input.operator,
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'exists';
        throw error;
      }
      return 'created';
    },
    async latestAction(subjectId) {
      const row = await prisma.staffAuditEvent.findFirst({
        where: { targetSubjectId: subjectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { action: true },
      });
      return row?.action ?? null;
    },
    async changeStatus(input) {
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string; subject_id: string; status: StaffMembershipStatus }>>`
          SELECT id, subject_id, status::text AS status
          FROM staff_members
          WHERE issuer = ${input.issuer}
          ORDER BY id
          FOR UPDATE
        `;
        const target = locked.find((row) => row.subject_id === input.subjectId);
        if (!target) return 'missing' as const;
        const active = locked.filter((row) => row.status === StaffMembershipStatus.active);
        const removesLastActive =
          !input.emergency &&
          target.status === StaffMembershipStatus.active &&
          (input.next === StaffMembershipStatus.inactive || input.next === StaffMembershipStatus.recovery) &&
          active.length === 1 &&
          active[0]?.subject_id === input.subjectId;
        if (removesLastActive) return 'last-operator' as const;
        if (input.onlyFrom && target.status !== input.onlyFrom && target.status !== input.next) {
          return 'blocked' as const;
        }
        if (target.status === input.next) {
          if (input.allowUnchanged || !input.onlyFrom || input.onlyFrom === input.next) return 'unchanged' as const;
          return 'blocked' as const;
        }
        await tx.staffMember.update({
          where: { id: target.id },
          data: { status: input.next },
        });
        await writeAudit(tx, {
          action: input.action,
          subjectId: input.subjectId,
          operator: input.operator,
          reason: input.reason,
        });
        return 'changed' as const;
      });
    },
  };
}

function writeAudit(
  tx: Prisma.TransactionClient,
  input: { action: StaffAuditAction; subjectId: string; operator: LifecycleOperator; reason?: string },
) {
  return tx.staffAuditEvent.create({
    data: {
      action: input.action,
      targetSubjectId: input.subjectId,
      unverifiedProcessUser: input.operator.unverifiedProcessUser,
      actorStaffMemberId: null,
      actorSubjectId: null,
      targetAccountId: null,
      reason: input.reason ?? null,
    },
  });
}
