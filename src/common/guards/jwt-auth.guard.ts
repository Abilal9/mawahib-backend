import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { MAWAHIB_PROFILE_MISSING_CODE } from '../auth/admission.codes';
import { IS_BOOTSTRAP_ALLOWED_KEY } from '../decorators/bootstrap-allowed.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
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
