import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  STAFF_ACCESS_DENIED,
  STAFF_SCHEMA_NOT_READY,
} from '../../common/auth/admission.codes';
import { isRecoveryJwt } from '../../common/auth/recovery-amr';
import type { StaffIdentity } from './staff-jwt.strategy';

/**
 * Runs after StaffJwtGuard. Issuer-aware membership is not wired in this
 * commit, so a verified staff token is refused here. This is not a switch
 * that can be turned on to admit subject-only rows.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ staff?: StaffIdentity }>();
    const identity = request.staff;
    if (!identity || identity.realm !== 'staff' || !identity.sub) {
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
    throw schemaNotReady();
  }
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
