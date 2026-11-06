import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@prisma/client';
import {
  STAFF_ACCESS_DENIED,
  STAFF_PENDING_ACTIVATION,
  STAFF_SCHEMA_NOT_READY,
} from '../../common/auth/admission.codes';
import { isRecoveryJwt } from '../../common/auth/recovery-amr';
import { STAFF_ROLE_KEY } from '../../common/decorators/staff-only.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { StaffIdentity } from './staff-jwt.strategy';
import { StaffMembershipService } from './staff-membership.service';
import { evaluateStaffMembership } from './staff-realm';
import {
  isUndefinedColumnError,
  resetStaffMembershipSchemaCache,
  staffMembershipSchemaReady,
} from './staff-schema';

/**
 * Runs after StaffJwtGuard. Membership is read on every request, by the
 * configured issuer and subject. A schema probe that is incomplete or fails
 * refuses the request. It is not treated as "not a staff member," and it
 * does not fall back to a subject-only lookup.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly staff: StaffMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ staff?: StaffIdentity }>();
    const identity = request.staff;
    if (!identity || identity.realm !== 'staff' || !identity.sub || !identity.issuer) {
      throw denied();
    }
    if (identity.role !== 'authenticated') {
      throw denied();
    }
    if (isRecoveryJwt({ amr: identity.amr })) {
      throw denied();
    }
    if (identity.aal !== 'aal2' || !hasTotpMethod(identity.amr)) {
      throw denied();
    }
    let ready = false;
    try {
      ready = await staffMembershipSchemaReady(this.prisma);
    } catch {
      throw schemaNotReady();
    }
    if (!ready) {
      throw schemaNotReady();
    }
    const required =
      this.reflector.getAllAndOverride<StaffRole>(STAFF_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? StaffRole.operator;
    let member: Awaited<ReturnType<StaffMembershipService['findForAdmission']>>;
    try {
      member = await this.staff.findForAdmission(identity.issuer, identity.sub);
    } catch (error) {
      if (isUndefinedColumnError(error)) {
        resetStaffMembershipSchemaCache();
        throw schemaNotReady();
      }
      throw error;
    }
    const decision = evaluateStaffMembership(member, required, identity.issuer);
    if (decision === 'pending') throw pending();
    if (decision !== 'admit') throw denied();
    return true;
  }
}

function pending(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: STAFF_PENDING_ACTIVATION,
    message: 'Staff access is waiting for activation.',
  });
}

function denied(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: STAFF_ACCESS_DENIED,
    message: 'Staff access is required.',
  });
}

function schemaNotReady(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: STAFF_SCHEMA_NOT_READY,
    message: 'Staff access is waiting for issuer-aware membership.',
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
