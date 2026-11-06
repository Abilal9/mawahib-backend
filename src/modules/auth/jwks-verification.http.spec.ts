/**
 * HTTP classification of JWKS failures. Loopback only.
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
import { AUTH_VERIFIER_UNAVAILABLE, STAFF_ACCESS_DENIED, STAFF_SCHEMA_NOT_READY } from '../../common/auth/admission.codes';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StaffGuard } from '../staff/staff.guard';
import { StaffJwtGuard } from '../staff/staff-jwt.guard';
import { StaffJwtStrategy } from '../staff/staff-jwt.strategy';
import { StaffMembershipService } from '../staff/staff-membership.service';
import { StaffSessionController } from '../staff/staff-session.controller';
import { resetStaffMembershipSchemaCache } from '../staff/staff-schema';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JWKS_MAX_STALE_MS } from './jwks-document';

const PRODUCT_ISSUER = 'https://product-test.supabase.co/auth/v1';
const STAFF_ISSUER = 'https://staff-test.supabase.co/auth/v1';
const SUBJECT = '22222222-2222-4222-8222-222222222222';

function pem(key: KeyObject, type: 'pkcs8' | 'spki'): string {
  return String(key.export({ type, format: 'pem' }));
}

function publicJwk(key: KeyObject, kid: string): Record<string, unknown> {
  return { ...(key.export({ format: 'jwk' }) as Record<string, unknown>), kid, alg: 'ES256', use: 'sig' };
}

const productPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const staffPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

function sign(privateKey: string, issuer: string, kid: string, expiresIn = 600): string {
  return jwt.sign({ sub: SUBJECT, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: 1 }] }, privateKey, {
    algorithm: 'ES256',
    audience: 'authenticated',
    issuer,
    expiresIn,
    keyid: kid,
  });
}

describe('JWKS verification HTTP responses', () => {
  let now = 1_700_000_000_000;
  let server: Server;
  let productUrl = '';
  let staffUrl = '';
  let mode: 'ok' | 'down' = 'ok';
  let app: INestApplication;
  const findUser = jest.fn();
  const findStaff = jest.fn();
  let schemaReady = true;

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    server = createServer((_req, res) => {
      if (mode === 'down') {
        res.writeHead(503);
        res.end('unavailable');
        return;
      }
      const key = _req.url === '/staff' ? publicJwk(staffPair.publicKey, 'kid-a') : publicJwk(productPair.publicKey, 'kid-a');
      const body = JSON.stringify({ keys: [key] });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    productUrl = `http://127.0.0.1:${address.port}/product`;
    staffUrl = `http://127.0.0.1:${address.port}/staff`;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    now = 1_700_000_000_000;
    mode = 'ok';
    schemaReady = true;
    findUser.mockReset().mockResolvedValue({ accountStatus: 'ACTIVE', deletedAt: null });
    findStaff.mockReset().mockResolvedValue({
      id: 'staff-1',
      issuer: STAFF_ISSUER,
      subjectId: SUBJECT,
      role: 'operator',
      status: 'active',
    });
    resetStaffMembershipSchemaCache();
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
              if (key === 'SUPABASE_URL') return 'https://product-test.supabase.co';
              if (key === 'SUPABASE_JWT_JWKS_URL') return productUrl;
              if (key === 'STAFF_SUPABASE_URL') return 'https://staff-test.supabase.co';
              if (key === 'STAFF_SUPABASE_JWKS_URL') return staffUrl;
              return undefined;
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: findUser, findMany: jest.fn() },
            staffMember: { findFirst: findStaff },
            $queryRaw: jest.fn(async () => [{ ok: schemaReady }]),
          },
        },
        {
          provide: UsersService,
          useValue: { getMe: jest.fn().mockResolvedValue({ id: SUBJECT }), bootstrap: jest.fn(), updateMe: jest.fn() },
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

  function http(): App {
    return app.getHttpServer() as App;
  }

  it('keeps missing, invalid, and unknown-key tokens unauthorized', async () => {
    const missing = await request(http()).get('/api/v1/admin/session');
    expect(missing.status).toBe(401);

    const expired = jwt.sign({ sub: SUBJECT, role: 'authenticated' }, pem(staffPair.privateKey, 'pkcs8'), {
      algorithm: 'ES256',
      audience: 'authenticated',
      issuer: STAFF_ISSUER,
      expiresIn: -10,
      keyid: 'kid-a',
    });
    const expiredResponse = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${expired}`);
    expect(expiredResponse.status).toBe(401);

    const unknown = sign(pem(staffPair.privateKey, 'pkcs8'), STAFF_ISSUER, 'missing-kid');
    const unknownResponse = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${unknown}`);
    expect(unknownResponse.status).toBe(401);
    expect(unknownResponse.body.code).toBeUndefined();

    const badSignature = `${sign(pem(staffPair.privateKey, 'pkcs8'), STAFF_ISSUER, 'kid-a')}x`;
    const badResponse = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${badSignature}`);
    expect(badResponse.status).toBe(401);
  });

  it('uses a cached staff key while the endpoint is down and fails closed after fifteen minutes', async () => {
    const token = sign(pem(staffPair.privateKey, 'pkcs8'), STAFF_ISSUER, 'kid-a', 7200);
    const ok = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);

    mode = 'down';
    now += 11 * 60 * 1000;
    const cached = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${token}`);
    expect(cached.status).toBe(200);

    now += JWKS_MAX_STALE_MS;
    const closed = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${token}`);
    expect(closed.status).toBe(503);
    expect(closed.body.code).toBe(AUTH_VERIFIER_UNAVAILABLE);
    expect(closed.body.message).toBe('Sign-in could not be verified right now.');

    mode = 'ok';
    now += 60_000;
    const recovered = await request(http()).get('/api/v1/admin/session').set('Authorization', `Bearer ${token}`);
    expect(recovered.status).toBe(200);
  });

  it('returns unavailable for a product cold start and does not accept the staff key', async () => {
    mode = 'down';
    const product = sign(pem(productPair.privateKey, 'pkcs8'), PRODUCT_ISSUER, 'kid-a', 7200);
    const outage = await request(http()).get('/api/v1/users/me').set('Authorization', `Bearer ${product}`);
    expect(outage.status).toBe(503);
    expect(outage.body.code).toBe(AUTH_VERIFIER_UNAVAILABLE);

    mode = 'ok';
    now += 30_000;
    const staffOnProduct = await request(http())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${sign(pem(staffPair.privateKey, 'pkcs8'), PRODUCT_ISSUER, 'kid-a', 7200)}`);
    expect(staffOnProduct.status).toBe(401);

    findStaff.mockResolvedValue(null);
    const denied = await request(http())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${sign(pem(staffPair.privateKey, 'pkcs8'), STAFF_ISSUER, 'kid-a', 7200)}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe(STAFF_ACCESS_DENIED);

    schemaReady = false;
    resetStaffMembershipSchemaCache();
    const schema = await request(http())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${sign(pem(staffPair.privateKey, 'pkcs8'), STAFF_ISSUER, 'kid-a', 7200)}`);
    expect(schema.status).toBe(503);
    expect(schema.body.code).toBe(STAFF_SCHEMA_NOT_READY);
  });
});
