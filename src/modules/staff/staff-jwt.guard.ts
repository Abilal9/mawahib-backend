import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import {
  AUTH_VERIFIER_UNAVAILABLE,
  STAFF_AUTH_UNAVAILABLE,
} from '../../common/auth/admission.codes';
import { isJwksDocumentUnavailable } from '../auth/jwks-document';
import type { Env } from '../../config/env.schema';
import { readStaffRealm } from './staff-realm';

@Injectable()
export class StaffJwtGuard extends AuthGuard('staff-jwt') {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const realm = readStaffRealm({
      staffUrl: this.config.get('STAFF_SUPABASE_URL', { infer: true }),
      staffJwksUrl: this.config.get('STAFF_SUPABASE_JWKS_URL', { infer: true }),
      productUrl: this.config.get('SUPABASE_URL', { infer: true }),
      productJwksUrl: this.config.get('SUPABASE_JWT_JWKS_URL', { infer: true }),
    });
    if (!realm) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: STAFF_AUTH_UNAVAILABLE,
        message: 'Staff sign-in is not configured.',
      });
    }
    const result = this.activate(context);
    if (typeof result === 'boolean') return result;
    if (isObservable(result)) return firstValueFrom(result);
    return result;
  }

  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (isJwksDocumentUnavailable(err) || isJwksDocumentUnavailable(info)) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: AUTH_VERIFIER_UNAVAILABLE,
        message: 'Sign-in could not be verified right now.',
      });
    }
    if (err || !user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  override getAuthenticateOptions() {
    return { property: 'staff', session: false };
  }

  private activate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
