import { Injectable, Logger } from '@nestjs/common';
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
 * Foundation stub for Supabase Auth JWT validation.
 * Prefers JWKS URL when set; falls back to symmetric JWT secret.
 * Does not implement login/signup — clients authenticate via Supabase Auth
 * and send the access token as Bearer.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(config: ConfigService<Env, true>) {
    const jwksUrl = config.get('SUPABASE_JWT_JWKS_URL', { infer: true });
    const jwtSecret = config.get('SUPABASE_JWT_SECRET', { infer: true });
    const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
    const issuer = supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined;

    if (jwksUrl) {
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        audience: 'authenticated',
        issuer,
        secretOrKeyProvider: passportJwtSecret({
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 5,
          jwksUri: jwksUrl,
        }),
      });
    } else {
      const secret =
        typeof jwtSecret === 'string' && jwtSecret.length > 0
          ? jwtSecret
          : 'unconfigured-supabase-jwt-secret';

      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: secret,
      });
    }

    if (!jwksUrl && !(typeof jwtSecret === 'string' && jwtSecret.length > 0)) {
      this.logger.warn(
        'SUPABASE_JWT_JWKS_URL / SUPABASE_JWT_SECRET not set — JWT verification uses a placeholder secret',
      );
    }
  }

  validate(payload: JwtPayload): JwtPayload {
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      aud: payload.aud,
      iss: payload.iss,
    };
  }
}
