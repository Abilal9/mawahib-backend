import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { STAFF_AUTH_UNAVAILABLE } from '../../common/auth/admission.codes';
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
  ): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException();
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
