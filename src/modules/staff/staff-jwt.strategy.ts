import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import type { Env } from '../../config/env.schema';
import { readStaffRealm } from './staff-realm';

export type StaffIdentity = {
  realm: 'staff';
  sub: string;
  role?: string;
  aal?: string;
  amr?: unknown;
  sessionId?: string;
  /** Configured staff issuer. Not taken from an unverified token. */
  issuer: string;
};

type StaffJwtClaims = {
  sub?: string;
  role?: unknown;
  aal?: unknown;
  amr?: unknown;
  session_id?: unknown;
  email?: unknown;
};

/**
 * Verifies staff-project access tokens. HS256 is not accepted.
 * The JWKS client is created here and is not the product strategy's client.
 * Construction does not fetch the key set.
 */
@Injectable()
export class StaffJwtStrategy extends PassportStrategy(Strategy, 'staff-jwt') {
  private readonly issuer: string | null;

  constructor(config: ConfigService<Env, true>) {
    const realm = readStaffRealm({
      staffUrl: config.get('STAFF_SUPABASE_URL', { infer: true }),
      staffJwksUrl: config.get('STAFF_SUPABASE_JWKS_URL', { infer: true }),
      productUrl: config.get('SUPABASE_URL', { infer: true }),
      productJwksUrl: config.get('SUPABASE_JWT_JWKS_URL', { infer: true }),
    });
    if (!realm) {
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        algorithms: ['ES256'],
        secretOrKey: 'staff-realm-disabled',
      });
      this.issuer = null;
      return;
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: 'authenticated',
      issuer: realm.issuer,
      algorithms: ['ES256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: realm.jwksUrl,
      }),
    });
    this.issuer = realm.issuer;
  }

  validate(payload: StaffJwtClaims): StaffIdentity {
    if (!this.issuer || !payload?.sub) {
      throw new UnauthorizedException();
    }
    return {
      realm: 'staff',
      sub: payload.sub,
      ...(typeof payload.role === 'string' ? { role: payload.role } : {}),
      ...(typeof payload.aal === 'string' ? { aal: payload.aal } : {}),
      ...(payload.amr !== undefined ? { amr: payload.amr } : {}),
      ...(typeof payload.session_id === 'string'
        ? { sessionId: payload.session_id }
        : {}),
      issuer: this.issuer,
    };
  }
}
