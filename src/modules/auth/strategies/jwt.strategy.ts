import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import type { Env } from '../../../config/env.schema';

export interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  iss?: string;
}

/**
 * Verifies Supabase Auth access tokens via JWKS (asymmetric) when configured,
 * falling back to SUPABASE_JWT_SECRET for HS256 projects.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(config: ConfigService<Env, true>) {
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
    this.logger.warn(
      'JWT verification: HS256 secret (configure JWKS for asymmetric keys)',
    );
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      aud: payload.aud,
      iss: payload.iss,
    };
  }
}
