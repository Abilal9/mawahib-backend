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
import { PrismaService } from '../../../infrastructure/database/prisma.service';

export interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  iss?: string;
}

export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';

/**
 * Verifies Supabase Auth access tokens via JWKS (asymmetric) when configured,
 * falling back to SUPABASE_JWT_SECRET for HS256 projects.
 *
 * After the token is valid, one primary-key read decides Mawahib access.
 * Account status is not cached and is not written into the JWT.
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

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const identity: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      aud: payload.aud,
      iss: payload.iss,
    };

    // Intentionally not findById: that helper hides soft-deleted rows, and a
    // suspended row with deletedAt set must still be denied.
    const row = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { accountStatus: true },
    });

    if (!row || row.accountStatus === AccountStatus.ACTIVE) {
      return identity;
    }

    if (row.accountStatus === AccountStatus.SUSPENDED) {
      throw new ForbiddenException({
        statusCode: 403,
        code: ACCOUNT_SUSPENDED_CODE,
        message: 'This account is suspended.',
      });
    }

    throw new InternalServerErrorException(
      'Account status could not be verified.',
    );
  }
}
