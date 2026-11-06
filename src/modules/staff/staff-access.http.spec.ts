/**
 * Synthetic ES256 tokens and a loopback JWKS server. This does not call
 * hosted Auth and does not prove what a refreshed session contains.
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { generateKeyPairSync, type KeyObject } from 'crypto';
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
import { resetStaffMembershipSchemaCache } from './staff-schema';
import { StaffSessionController } from './staff-session.controller';

const PRODUCT_URL = 'https://product-test.supabase.co';
const STAFF_URL = 'https://staff-test.supabase.co';
const PRODUCT_ISSUER = `${PRODUCT_URL}/auth/v1`;
const STAFF_ISSUER = `${STAFF_URL}/auth/v1`;
const SAME_SUBJECT = '22222222-2222-4222-8222-222222222222';
const SAME_EMAIL = 'same.person@example.com';
const SHARED_KID = 'shared-kid';

function pem(key: KeyObject, type: 'pkcs8' | 'spki'): string {
  return String(key.export({ type, format: 'pem' }));
}

function publicJwk(key: KeyObject): Record<string, unknown> {
  return {
    ...(key.export({ format: 'jwk' }) as Record<string, unknown>),
    kid: SHARED_KID,
    alg: 'ES256',
    use: 'sig',
  };
}

const productPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const staffPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PRODUCT_PRIVATE = pem(productPair.privateKey, 'pkcs8');
const STAFF_PRIVATE = pem(staffPair.privateKey, 'pkcs8');
const hits = { product: 0, staff: 0 };
let jwksServer: Server;
let productJwksUrl = '';
let staffJwksUrl = '';

beforeAll(async () => {
  jwksServer = createServer((req, res) => {
    const document =
      req.url === '/product'
        ? publicJwk(productPair.publicKey)
        : req.url === '/staff'
          ? publicJwk(staffPair.publicKey)
          : null;
    if (!document) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.url === '/product') hits.product += 1;
    if (req.url === '/staff') hits.staff += 1;
    const body = JSON.stringify({ keys: [document] });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => {
    jwksServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = jwksServer.address() as AddressInfo;
  productJwksUrl = `http://127.0.0.1:${address.port}/product`;
  staffJwksUrl = `http://127.0.0.1:${address.port}/staff`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    jwksServer.close((error) => (error ? reject(error) : resolve()));
  });
});

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
      ...(algorithm === 'ES256' ? { keyid: SHARED_KID } : {}),
    },
  );
}

function staffToken(overrides: Record<string, unknown> = {}, options: Parameters<typeof sign>[3] = {}) {
  return sign(STAFF_PRIVATE, STAFF_ISSUER, overrides, options);
}

function productToken(overrides: Record<string, unknown> = {}) {
  return sign(PRODUCT_PRIVATE, PRODUCT_ISSUER, overrides);
}

describe('separate staff and product authentication', () => {
  let app: INestApplication;
  const findUser = jest.fn();
  const findStaff = jest.fn();
  let schemaReady = true;
  let schemaThrows = false;

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
              if (key === 'SUPABASE_JWT_JWKS_URL') return productJwksUrl;
              if (!staffConfigured) return undefined;
              if (key === 'STAFF_SUPABASE_URL') return STAFF_URL;
              if (key === 'STAFF_SUPABASE_JWKS_URL') return staffJwksUrl;
              return undefined;
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: findUser, findMany: jest.fn() },
            staffMember: { findFirst: findStaff },
            $queryRaw: jest.fn(async () => {
              if (schemaThrows) throw new Error('catalog unavailable');
              return [{ ok: schemaReady }];
            }),
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
    schemaReady = true;
    schemaThrows = false;
    resetStaffMembershipSchemaCache();
    hits.product = 0;
    hits.staff = 0;
    app = await createApp(true);
  });

  afterEach(async () => {
    await app.close();
  });

  function server(): App {
    return app.getHttpServer() as App;
  }

  it('fetches each realm document once and keeps the caches apart', async () => {
    findUser.mockResolvedValue(null);
    await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${productToken()}`);
    await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken()}`);
    await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${productToken()}`);
    await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(hits.product).toBe(1);
    expect(hits.staff).toBe(1);
    expect(productJwksUrl).not.toBe(staffJwksUrl);
  });

  it('rejects a missing staff token', async () => {
    const response = await request(server()).get('/api/v1/admin/session');
    expect(response.status).toBe(401);
  });

  it('rejects a bad signature, audience, issuer, expiry, and HS256 on staff routes', async () => {
    const badSignature = `${staffToken()}x`;
    const forgedAudience = sign(STAFF_PRIVATE, STAFF_ISSUER, {}, { audience: 'anon' });
    const wrongIssuer = sign(STAFF_PRIVATE, 'https://other.example/auth/v1');
    const expired = jwt.sign(
      { sub: SAME_SUBJECT, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp' }] },
      STAFF_PRIVATE,
      {
        algorithm: 'ES256',
        audience: 'authenticated',
        issuer: STAFF_ISSUER,
        expiresIn: -10,
        keyid: SHARED_KID,
      },
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

  it('rejects a matching key id from the other realm', async () => {
    findUser.mockResolvedValue(null);
    const staffRoute = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${sign(PRODUCT_PRIVATE, STAFF_ISSUER)}`);
    expect(staffRoute.status).toBe(401);
    const productRoute = await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${sign(STAFF_PRIVATE, PRODUCT_ISSUER)}`);
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
    expect(staff.status).toBe(403);
    expect(staff.body.code).toBe(STAFF_ACCESS_DENIED);
    expect(findStaff).toHaveBeenCalledWith({
      where: { issuer: STAFF_ISSUER, subjectId: SAME_SUBJECT },
      select: { id: true, issuer: true, subjectId: true, role: true, status: true },
    });
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

  it('refuses staff access when the issuer column is missing or the catalog read fails', async () => {
    schemaReady = false;
    findStaff.mockResolvedValue({
      id: 'member',
      issuer: STAFF_ISSUER,
      subjectId: SAME_SUBJECT,
      role: 'operator',
      status: 'active',
    });
    const missing = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(missing.status).toBe(503);
    expect(missing.body.code).toBe(STAFF_SCHEMA_NOT_READY);
    expect(findStaff).not.toHaveBeenCalled();

    schemaThrows = true;
    resetStaffMembershipSchemaCache();
    const failed = await request(server())
      .get('/api/v1/admin/users?q=ada@example.com')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe(STAFF_SCHEMA_NOT_READY);
    expect(findStaff).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', 'STAFF_PENDING_ACTIVATION'],
    ['inactive', 'STAFF_ACCESS_DENIED'],
  ] as const)('denies %s membership for the staff issuer', async (status, code) => {
    findStaff.mockResolvedValue({
      id: 'member',
      issuer: STAFF_ISSUER,
      subjectId: SAME_SUBJECT,
      role: 'operator',
      status,
    });
    const response = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(code);
  });

  it('denies inactive and recovery membership on every staff route in this app', async () => {
    for (const status of ['inactive', 'recovery'] as const) {
      findStaff.mockResolvedValue({
        id: 'member',
        issuer: STAFF_ISSUER,
        subjectId: SAME_SUBJECT,
        role: 'operator',
        status,
      });
      for (const path of ['/api/v1/admin/session', '/api/v1/admin/users?q=ada', '/api/v1/admin/operations']) {
        const response = await request(server()).get(path).set('Authorization', `Bearer ${staffToken()}`);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe(STAFF_ACCESS_DENIED);
      }
    }
  });

  it('admits an active staff membership and ignores a same subject in another issuer', async () => {
    findStaff.mockImplementation(async (args: { where: { issuer: string } }) => {
      if (args.where.issuer !== STAFF_ISSUER) return null;
      return {
        id: 'member',
        issuer: STAFF_ISSUER,
        subjectId: SAME_SUBJECT,
        role: 'operator',
        status: 'active',
      };
    });
    const response = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: 'operator', membership: 'active' });
  });

  it('reads operations for an admitted staff token and ignores a caller-selected target', async () => {
    findStaff.mockResolvedValue({
      id: 'member',
      issuer: STAFF_ISSUER,
      subjectId: SAME_SUBJECT,
      role: 'operator',
      status: 'active',
    });
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
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('evil.example');
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
        StaffMembershipService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'SUPABASE_URL') return PRODUCT_URL;
              if (key === 'SUPABASE_JWT_JWKS_URL') return productJwksUrl;
              return undefined;
            },
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
