/**
 * Synthetic ES256 tokens only. This does not call hosted Auth and does not
 * prove what aal or amr a refreshed Supabase session actually contains.
 */
jest.mock('jwks-rsa', () => {
  const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
  const staff = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const product = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const exportPem = (key: { export: (options: { type: string; format: string }) => string | Buffer }, type: 'pkcs8' | 'spki') =>
    String(key.export({ type, format: 'pem' }));
  const keys = {
    staffPublic: exportPem(staff.publicKey, 'spki'),
    staffPrivate: exportPem(staff.privateKey, 'pkcs8'),
    productPublic: exportPem(product.publicKey, 'spki'),
    productPrivate: exportPem(product.privateKey, 'pkcs8'),
    jwksUris: [] as string[],
  };
  (global as unknown as { __REALM_KEYS?: typeof keys }).__REALM_KEYS = keys;
  return {
    passportJwtSecret: (options: { jwksUri?: string }) => {
      const uri = String(options?.jwksUri ?? '');
      keys.jwksUris.push(uri);
      const pem = uri.includes('staff-test') ? keys.staffPublic : keys.productPublic;
      return (_request: unknown, _token: unknown, done: Function) => done(null, pem);
    },
  };
});

import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  MAWAHIB_PROFILE_MISSING_CODE,
  STAFF_AUTH_UNAVAILABLE,
  STAFF_ACCESS_DENIED,
  STAFF_SCHEMA_NOT_READY,
} from '../../common/auth/admission.codes';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HealthService } from '../health/health.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { StaffGuard } from './staff.guard';
import { StaffJwtGuard } from './staff-jwt.guard';
import { StaffJwtStrategy } from './staff-jwt.strategy';
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

const PRODUCT_URL = 'https://product-test.supabase.co';
const STAFF_URL = 'https://staff-test.supabase.co';
const PRODUCT_ISSUER = `${PRODUCT_URL}/auth/v1`;
const STAFF_ISSUER = `${STAFF_URL}/auth/v1`;
const SAME_SUBJECT = '22222222-2222-4222-8222-222222222222';
const SAME_EMAIL = 'same.person@example.com';

function keys() {
  return (
    global as unknown as {
      __REALM_KEYS: {
        staffPublic: string;
        staffPrivate: string;
        productPublic: string;
        productPrivate: string;
        jwksUris: string[];
      };
    }
  ).__REALM_KEYS;
}

function sign(
  privatePem: string,
  issuer: string,
  overrides: Record<string, unknown> = {},
  options: { algorithm?: jwt.Algorithm; audience?: string; expiresIn?: number } = {},
): string {
  const algorithm = options.algorithm ?? 'ES256';
  return jwt.sign(
    {
      sub: SAME_SUBJECT,
      email: SAME_EMAIL,
      role: 'authenticated',
      aal: 'aal2',
      amr: [{ method: 'totp', timestamp: 1 }],
      session_id: 'synthetic-session',
      ...overrides,
    },
    algorithm === 'HS256' ? 'shared-secret' : privatePem,
    {
      algorithm,
      audience: options.audience ?? 'authenticated',
      issuer,
      expiresIn: options.expiresIn ?? 600,
    },
  );
}

function staffToken(overrides: Record<string, unknown> = {}, options: Parameters<typeof sign>[3] = {}) {
  return sign(keys().staffPrivate, STAFF_ISSUER, overrides, options);
}

function productToken(overrides: Record<string, unknown> = {}) {
  return sign(keys().productPrivate, PRODUCT_ISSUER, overrides);
}

describe('separate staff and product authentication', () => {
  let app: INestApplication;
  const findUser = jest.fn();
  const findStaff = jest.fn();

  async function createApp(staffConfigured: boolean) {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        StaffSessionController,
        AdminReadController,
        AccountStatusController,
        OperationsController,
        UsersController,
      ],
      providers: [
        JwtAuthGuard,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        JwtStrategy,
        StaffJwtStrategy,
        StaffJwtGuard,
        StaffGuard,
        StaffMembershipService,
        AdminReadService,
        AccountStatusService,
        OperationsService,
        {
          provide: HealthService,
          useValue: { sharedConnectivity: jest.fn().mockResolvedValue('connected') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'SUPABASE_URL') return PRODUCT_URL;
              if (key === 'SUPABASE_JWT_JWKS_URL') {
                return `${PRODUCT_URL}/auth/v1/.well-known/jwks.json`;
              }
              if (!staffConfigured) return undefined;
              if (key === 'STAFF_SUPABASE_URL') return STAFF_URL;
              if (key === 'STAFF_SUPABASE_JWKS_URL') {
                return `${STAFF_URL}/auth/v1/.well-known/jwks.json`;
              }
              return undefined;
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: findUser, findMany: jest.fn() },
            staffMember: { findUnique: findStaff },
            payment: { count: jest.fn() },
            workEngagement: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
          },
        },
        {
          provide: UsersService,
          useValue: { getMe: jest.fn(), bootstrap: jest.fn(), updateMe: jest.fn() },
        },
      ],
    }).compile();
    const next = moduleRef.createNestApplication();
    next.setGlobalPrefix('api/v1');
    next.useGlobalFilters(new AllExceptionsFilter());
    await next.init();
    return next;
  }

  beforeEach(async () => {
    findUser.mockReset();
    findStaff.mockReset();
    keys().jwksUris.length = 0;
    app = await createApp(true);
  });

  afterEach(async () => {
    await app.close();
  });

  function server(): App {
    return app.getHttpServer() as App;
  }

  it('keeps separate JWKS clients for the two realms', () => {
    expect(keys().jwksUris).toEqual(
      expect.arrayContaining([
        `${PRODUCT_URL}/auth/v1/.well-known/jwks.json`,
        `${STAFF_URL}/auth/v1/.well-known/jwks.json`,
      ]),
    );
    expect(new Set(keys().jwksUris).size).toBe(2);
  });

  it('rejects a missing staff token', async () => {
    const response = await request(server()).get('/api/v1/admin/session');
    expect(response.status).toBe(401);
  });

  it('rejects a bad signature, audience, issuer, expiry, and HS256 on staff routes', async () => {
    const badSignature = `${staffToken()}x`;
    const forgedAudience = sign(keys().staffPrivate, STAFF_ISSUER, {}, { audience: 'anon' });
    const wrongIssuer = sign(keys().staffPrivate, 'https://other.example/auth/v1');
    const expired = jwt.sign(
      { sub: SAME_SUBJECT, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp' }] },
      keys().staffPrivate,
      { algorithm: 'ES256', audience: 'authenticated', issuer: STAFF_ISSUER, expiresIn: -10 },
    );
    const hs256 = staffToken({}, { algorithm: 'HS256' });
    for (const token of [badSignature, forgedAudience, wrongIssuer, expired, hs256]) {
      const response = await request(server())
        .get('/api/v1/admin/session')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
    }
    expect(findStaff).not.toHaveBeenCalled();
  });

  it('rejects a product token on a staff route and a staff token on a product route', async () => {
    findUser.mockResolvedValue(null);
    const staffRoute = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${productToken()}`);
    expect(staffRoute.status).toBe(401);

    const productRoute = await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(productRoute.status).toBe(401);
    expect(productRoute.body.code).not.toBe(MAWAHIB_PROFILE_MISSING_CODE);
    expect(findStaff).not.toHaveBeenCalled();
  });

  it('does not treat the same email or subject as authority in the other realm', async () => {
    findUser.mockResolvedValue(null);
    const product = await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${productToken({ email: SAME_EMAIL, sub: SAME_SUBJECT })}`);
    expect(product.status).toBe(401);
    expect(product.body.code).toBe(MAWAHIB_PROFILE_MISSING_CODE);
    findUser.mockClear();

    const staff = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken({ email: SAME_EMAIL, sub: SAME_SUBJECT })}`);
    expect(staff.status).toBe(503);
    expect(staff.body.code).toBe(STAFF_SCHEMA_NOT_READY);
    expect(findStaff).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
  });

  it('denies malformed staff assurance before any membership lookup', async () => {
    const cases = [
      { aal: 'aal1' },
      { aal: undefined },
      { amr: 'totp' },
      { amr: [{ method: 'password', timestamp: 1 }] },
      { amr: [{ method: 1 }] },
      { amr: [{ method: 'recovery', timestamp: 1 }, { method: 'totp', timestamp: 2 }] },
      { role: 'anon' },
    ];
    for (const overrides of cases) {
      const response = await request(server())
        .get('/api/v1/admin/session')
        .set('Authorization', `Bearer ${staffToken(overrides)}`);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(STAFF_ACCESS_DENIED);
    }
    expect(findStaff).not.toHaveBeenCalled();
  });

  it('does not authorize a valid staff token before issuer-aware membership exists', async () => {
    findStaff.mockResolvedValue({
      subjectId: SAME_SUBJECT,
      role: 'operator',
      status: 'active',
    });
    const response = await request(server())
      .get('/api/v1/admin/users?q=ada@example.com')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe(STAFF_SCHEMA_NOT_READY);
    expect(response.body.message).toBe('Staff access is waiting for issuer-aware membership.');
    expect(findStaff).not.toHaveBeenCalled();
  });

  it('keeps a refreshed aal2 totp token from reading membership or providers', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('providers are not called'));
    const response = await request(server())
      .get('/api/v1/admin/operations?project=https://evil.example')
      .set('Authorization', `Bearer ${staffToken({
        amr: [
          { method: 'token_refresh', timestamp: 30 },
          { method: 'totp', timestamp: 10 },
          { method: 'password', timestamp: 1 },
        ],
      })}`);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe(STAFF_SCHEMA_NOT_READY);
    expect(JSON.stringify(response.body)).not.toContain('evil.example');
    expect(findStaff).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('leaves product profile admission unchanged for a product token', async () => {
    findUser.mockResolvedValue(null);
    const response = await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${productToken()}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(MAWAHIB_PROFILE_MISSING_CODE);
  });
});

describe('staff routes without staff configuration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [StaffSessionController, UsersController],
      providers: [
        JwtAuthGuard,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        JwtStrategy,
        StaffJwtStrategy,
        StaffJwtGuard,
        StaffGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'SUPABASE_URL' ? PRODUCT_URL : undefined),
          },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn().mockResolvedValue(null) } },
        },
        {
          provide: UsersService,
          useValue: { getMe: jest.fn(), bootstrap: jest.fn(), updateMe: jest.fn() },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a controlled unavailable response and still admits product tokens to product checks', async () => {
    const staff = await request(app.getHttpServer() as App)
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(staff.status).toBe(503);
    expect(staff.body.code).toBe(STAFF_AUTH_UNAVAILABLE);
    expect(staff.body.message).toBe('Staff sign-in is not configured.');

    const product = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${productToken()}`);
    expect(product.status).toBe(401);
    expect(product.body.code).toBe(MAWAHIB_PROFILE_MISSING_CODE);
  });
});
