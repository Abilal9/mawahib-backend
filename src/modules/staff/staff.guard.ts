import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffMembershipStatus, StaffRole } from '@prisma/client';
import { STAFF_ACCESS_DENIED } from '../../common/auth/admission.codes';
import { STAFF_ROLE_KEY } from '../../common/decorators/staff-only.constants';
import type { RequestAuthIdentity } from '../auth/strategies/jwt.strategy';
import { StaffMembershipService } from './staff-membership.service';

/**
 * Runs after the global JwtAuthGuard. Membership is read on every request.
 * Pending and inactive rows do not pass. A product User row does not pass.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly staff: StaffMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestAuthIdentity }>();
    const identity = request.user;
    if (!identity?.sub) {
      throw denied();
    }
    if (identity.role !== 'authenticated') {
      throw denied();
    }
    if (identity.aal !== 'aal2' || !hasTotpMethod(identity.amr)) {
      throw denied();
    }
    if (identity.mawahib?.kind !== 'missing') {
      throw denied();
    }

    const required =
      this.reflector.getAllAndOverride<StaffRole>(STAFF_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? StaffRole.operator;
    const member = await this.staff.findBySubject(identity.sub);
    if (
      !member ||
      member.status !== StaffMembershipStatus.active ||
      member.role !== required
    ) {
      throw denied();
    }
    return true;
  }
}

function denied(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: STAFF_ACCESS_DENIED,
    message: 'Staff access is required.',
  });
}

/** True only for a provider AMR object whose method is totp. */
export function hasTotpMethod(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object' || !('method' in entry)) {
      return false;
    }
    return (entry as { method?: unknown }).method === 'totp';
  });
}
