import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import type { Env } from '../../../config/env.schema';
import {
  ACCOUNT_SUSPENDED_CODE,
  ACCOUNT_UNAVAILABLE_CODE,
} from '../../../common/auth/admission.codes';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

export { ACCOUNT_SUSPENDED_CODE } from '../../../common/auth/admission.codes';

export interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  iss?: string;
  amr?: unknown;
}

export type MawahibAdmission =
  | { kind: 'missing' }
  | { kind: 'active' };

export interface RequestAuthIdentity extends JwtPayload {
  mawahib: MawahibAdmission;
}

/**
 * Rejects a JWT only when an AMR entry is explicitly `recovery`.
 *
 * The observed signup verification and the observed six-digit recovery
 * code both carried method `otp`. Treating every `otp` token as recovery
 * would block legitimate signup, so this check does not do that. For an
 * active account, that hosted recovery OTP session is admitted to ordinary
 * private APIs. Account status, ownership, participation, and the other
 * authorization checks still apply.
 *
 * The frontend recovery lock keeps that app instance on the recovery flow
 * and blocks its own product calls. It is an app restriction, not a
 * server-enforced recovery-session boundary, and it does not stop a direct
 * request. No additional recovery classifier is introduced here.
 *
 * Accepted for the current feature scope: control of the recovery inbox
 * allows use of that session before the password is changed, while the
 * original password and other sessions may remain usable. Real payments,
 * payouts, bank-detail changes, account deletion, and other high-impact
 * capabilities need a separate step-up assessment before launch.
 */
export function isRecoveryJwt(payload: Pick<JwtPayload, 'amr'>): boolean {
  const amr = payload.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry === 'string') return entry === 'recovery';
    if (entry && typeof entry === 'object' && 'method' in entry) {
      return (entry as { method?: unknown }).method === 'recovery';
    }
    return false;
  });
}

/**
 * Verifies Supabase Auth access tokens via JWKS (asymmetric) when configured,
 * falling back to SUPABASE_JWT_SECRET for HS256 projects.
 *
 * After the token is valid, one primary-key read decides Mawahib access.
 * Account status is not cached and is not written into the JWT.
 * Missing rows are not treated as authenticated product users.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly prisma!: PrismaService;

  constructor(config: ConfigService<Env, true>, prisma: PrismaService) {
    const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
    const jwksUrl =
      config.get('SUPABASE_JWT_JWKS_URL', { infer: true }) ??
      (supabaseUrl
        ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
        : undefined);
    const jwtSecret = config.get('SUPABASE_JWT_SECRET', { infer: true });
    const issuer = supabaseUrl
      ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1`
      : undefined;

    if (jwksUrl) {
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        audience: 'authenticated',
        issuer,
        algorithms: ['ES256', 'RS256'],
        secretOrKeyProvider: passportJwtSecret({
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
          jwksUri: jwksUrl,
        }),
      });
      this.prisma = prisma;
      this.logger.log('JWT verification: JWKS');
      return;
    }

    if (!jwtSecret) {
      throw new Error(
        'SUPABASE_JWT_JWKS_URL or SUPABASE_JWT_SECRET is required for JWT verification',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: 'authenticated',
      issuer,
      algorithms: ['HS256'],
      secretOrKey: jwtSecret,
    });
    this.prisma = prisma;
    this.logger.warn(
      'JWT verification: HS256 secret (configure JWKS for asymmetric keys)',
    );
  }

  async validate(payload: JwtPayload): Promise<RequestAuthIdentity> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (isRecoveryJwt(payload)) {
      throw new UnauthorizedException('Recovery credentials cannot access Mawahib');
    }

    const identity: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      aud: payload.aud,
      iss: payload.iss,
    };

    // Intentionally not findById: that helper hides soft-deleted rows.
    const row = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { accountStatus: true, deletedAt: true },
    });

    if (!row) {
      return { ...identity, mawahib: { kind: 'missing' } };
    }

    if (row.accountStatus === AccountStatus.SUSPENDED) {
      throw new ForbiddenException({
        statusCode: 403,
        code: ACCOUNT_SUSPENDED_CODE,
        message: 'This account is suspended.',
      });
    }

    if (row.deletedAt) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: ACCOUNT_UNAVAILABLE_CODE,
        message: 'This account is unavailable.',
      });
    }

    if (row.accountStatus === AccountStatus.ACTIVE) {
      return { ...identity, mawahib: { kind: 'active' } };
    }

    throw new InternalServerErrorException(
      'Account status could not be verified.',
    );
  }
}
