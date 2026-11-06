import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Portal admission only. Operator invitation and activation live in staff-lifecycle
 * and are not exposed as web routes. These writes stay disabled.
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
