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

export type PendingProvisionResult =
  | { created: true }
  | { created: false; unchanged: 'pending' };

export class StaffMembershipNotReadyError extends Error {
  constructor() {
    super(
      'Staff membership changes are disabled until records include an issuer. Nothing was written.',
    );
  }
}

@Injectable()
export class StaffMembershipService {
  constructor(_prisma: PrismaService) {}

  async findBySubject(_subjectId: string): Promise<null> {
    throw new StaffMembershipNotReadyError();
  }

  async holdProductSubject(_subjectId: string): Promise<void> {
    throw new StaffMembershipNotReadyError();
  }

  /**
   * Refuses before any read or write. Subject-only pending rows are not created.
   * The process user on a future audit row is the OS account that ran the
   * command, not a verified staff actor.
   */
  async provisionPending(
    _subjectId: string,
    _actor: UnverifiedProcessActor,
  ): Promise<PendingProvisionResult> {
    throw new StaffMembershipNotReadyError();
  }
}
