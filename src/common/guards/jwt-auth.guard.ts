import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import {
  AUTH_VERIFIER_UNAVAILABLE,
  MAWAHIB_PROFILE_MISSING_CODE,
} from '../auth/admission.codes';
import { isJwksDocumentUnavailable } from '../../modules/auth/jwks-document';
import { IS_BOOTSTRAP_ALLOWED_KEY } from '../decorators/bootstrap-allowed.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { STAFF_ONLY_KEY } from '../decorators/staff-only.constants';
import type { RequestAuthIdentity } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.hasMetadata(context, IS_PUBLIC_KEY)) {
      return true;
    }

    if (this.hasMetadata(context, STAFF_ONLY_KEY)) {
      return true;
    }

    const allowed = await this.activateJwt(context);
    if (!allowed) return false;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestAuthIdentity }>();
    const identity = request.user;
    if (!identity?.sub) {
      throw new UnauthorizedException();
    }

    if (identity.mawahib?.kind === 'active') {
      return true;
    }

    if (
      identity.mawahib?.kind === 'missing' &&
      this.hasMetadata(context, IS_BOOTSTRAP_ALLOWED_KEY)
    ) {
      return true;
    }

    if (identity.mawahib?.kind === 'missing') {
      throw new UnauthorizedException({
        statusCode: 401,
        code: MAWAHIB_PROFILE_MISSING_CODE,
        message: 'Mawahib profile is missing.',
      });
    }

    throw new UnauthorizedException();
  }

  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    if (isJwksDocumentUnavailable(err) || isJwksDocumentUnavailable(info)) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: AUTH_VERIFIER_UNAVAILABLE,
        message: 'Sign-in could not be verified right now.',
      });
    }
    return super.handleRequest(err, user, info, context, status);
  }

  private hasMetadata(context: ExecutionContext, key: string): boolean {
    return this.reflector.getAllAndOverride<boolean>(key, [
      context.getHandler(),
      context.getClass(),
    ]) === true;
  }

  private async activateJwt(context: ExecutionContext): Promise<boolean> {
    const result = super.canActivate(context);
    if (typeof result === 'boolean') return result;
    if (isObservable(result)) return firstValueFrom(result);
    return result;
  }
}
