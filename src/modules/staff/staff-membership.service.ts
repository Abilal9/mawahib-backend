import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AuthSubjectKind,
  Prisma,
  StaffAuditAction,
  StaffMembershipStatus,
  StaffRole,
} from '@prisma/client';
import { STAFF_PRODUCT_SEPARATION_CODE } from '../../common/auth/admission.codes';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Later lifecycle, not implemented here:
 * Routine deactivation must refuse to remove the last active operator.
 * An explicit audited emergency deactivation of that same operator must
 * remain possible when the identity is compromised. Do not make the last
 * active operator impossible to disable.
 */
export type UnverifiedProcessActor = {
  unverifiedProcessUser: string;
};

export type PendingProvisionResult =
  | { created: true }
  | { created: false; unchanged: 'pending' };

type Tx = Prisma.TransactionClient;

@Injectable()
export class StaffMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  findBySubject(subjectId: string) {
    return this.prisma.staffMember.findUnique({ where: { subjectId } });
  }

  /**
   * Reserves the Auth subject as a product identity before other bootstrap work.
   * The reservation commits on its own. User creation follows and can be retried.
   * An orphan product reservation still blocks staff provisioning. It does not
   * create a product user. Existing product rows are protected by the user-id
   * check in provisionPending even when they have no reservation yet.
   */
  async holdProductSubject(subjectId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await reserveSubject(tx, subjectId, AuthSubjectKind.product);
    });
  }

  /**
   * Creates a pending operator membership and its audit row together.
   * Does not activate the row or enroll a factor.
   * Repeating it for an existing pending row does not write another audit row.
   */
  async provisionPending(
    subjectId: string,
    actor: UnverifiedProcessActor,
  ): Promise<PendingProvisionResult> {
    return this.prisma.$transaction(async (tx) => {
      const productUser = await tx.user.findUnique({
        where: { id: subjectId },
        select: { id: true },
      });
      if (productUser) {
        throw new ConflictException(
          'A product identity already exists for this subject.',
        );
      }

      const existing = await tx.staffMember.findUnique({
        where: { subjectId },
      });
      if (existing?.status === StaffMembershipStatus.pending) {
        return { created: false, unchanged: 'pending' };
      }
      if (existing) {
        throw new ConflictException(
          'Staff membership already exists and was not changed.',
        );
      }

      await reserveSubject(tx, subjectId, AuthSubjectKind.staff);
      await tx.staffMember.create({
        data: {
          subjectId,
          role: StaffRole.operator,
          status: StaffMembershipStatus.pending,
        },
      });
      await tx.staffAuditEvent.create({
        data: {
          action: StaffAuditAction.membership_pending_recorded,
          targetSubjectId: subjectId,
          unverifiedProcessUser: actor.unverifiedProcessUser,
        },
      });
      return { created: true };
    });
  }
}

async function reserveSubject(
  tx: Tx,
  subjectId: string,
  kind: AuthSubjectKind,
): Promise<void> {
  // ON CONFLICT DO NOTHING. Catching a unique violation inside a Prisma
  // transaction aborts the Postgres transaction, so a later read cannot run.
  await tx.authSubjectReservation.createMany({
    data: [{ subjectId, kind }],
    skipDuplicates: true,
  });
  const existing = await tx.authSubjectReservation.findUnique({
    where: { subjectId },
  });
  if (existing?.kind === kind) return;
  throw new ForbiddenException({
    statusCode: 403,
    code: STAFF_PRODUCT_SEPARATION_CODE,
    message: 'This identity cannot be used for that purpose.',
  });
}
