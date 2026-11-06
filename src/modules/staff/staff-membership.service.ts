import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Later lifecycle, not implemented here:
 * Lost factor: set membership inactive and write the audit row first, then
 * change the provider factor or session. Re-enroll and activate only after
 * a verified factor exists. A failed provider call must not restore membership.
 * Ordinary removal must refuse to leave zero active operators. Emergency
 * removal of the last operator stays a separate audited command.
 */
export type UnverifiedProcessActor = {
  unverifiedProcessUser: string;
};

export class StaffMembershipNotReadyError extends Error {
  constructor() {
    super(
      'Staff provisioning is disabled until a reviewed activation command exists. Nothing was written.',
    );
  }
}

@Injectable()
export class StaffMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  findForAdmission(issuer: string, subjectId: string) {
    return this.prisma.staffMember.findFirst({
      where: { issuer, subjectId },
      select: { id: true, issuer: true, subjectId: true, role: true, status: true },
    });
  }

  async holdProductSubject(_subjectId: string): Promise<void> {
    throw new StaffMembershipNotReadyError();
  }

  async provisionPending(
    _subjectId: string,
    _actor: UnverifiedProcessActor,
  ): Promise<never> {
    throw new StaffMembershipNotReadyError();
  }
}
