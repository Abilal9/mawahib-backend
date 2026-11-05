/**
 * Synthetic tokens only. This does not call hosted Auth and does not prove
 * what aal or amr a refreshed Supabase session actually contains.
 */
jest.mock('jwks-rsa', () => {
  const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  (global as unknown as { __STAFF_KEYS?: { publicPem: string; privatePem: string } }).__STAFF_KEYS =
    {
      publicPem: String(publicPem),
      privatePem: String(privatePem),
    };
  return {
    passportJwtSecret: () => (_request: unknown, _token: unknown, done: Function) =>
      done(null, String(publicPem)),
  };
});

import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AccountStatus, StaffMembershipStatus, StaffRole } from '@prisma/client';
import { PassportModule } from '@nestjs/passport';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  MAWAHIB_PROFILE_MISSING_CODE,
  STAFF_ACCESS_DENIED,
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
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

const ISSUER = 'https://staff-test.supabase.co/auth/v1';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function keys(): { publicPem: string; privatePem: string } {
  return (
    global as unknown as {
      __STAFF_KEYS: { publicPem: string; privatePem: string };
    }
  ).__STAFF_KEYS;
}

function signToken(
  sub: string,
  overrides: Record<string, unknown> = {},
  options: { expiresIn?: number; issuer?: string } = {},
): string {
  const { privatePem } = keys();
  return jwt.sign(
    {
      sub,
      role: 'authenticated',
      aal: 'aal2',
      amr: [{ method: 'totp', timestamp: 1 }],
      session_id: 'synthetic-session',
      ...overrides,
    },
    privatePem,
    {
      algorithm: 'RS256',
      audience: 'authenticated',
      issuer: options.issuer ?? ISSUER,
      expiresIn: options.expiresIn ?? 600,
    },
  );
}

describe('staff authorization', () => {
  let app: INestApplication;
  const findUser = jest.fn();
  const findStaff = jest.fn();
  const findUsers = jest.fn();
  const findDispute = jest.fn();
  const users = { getMe: jest.fn(), bootstrap: jest.fn(), updateMe: jest.fn() };

  beforeEach(async () => {
    findUser.mockReset();
    findStaff.mockReset();
    users.getMe.mockReset();

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
            get: (key: string) =>
              key === 'SUPABASE_URL'
                ? 'https://staff-test.supabase.co'
                : undefined,
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: findUser, findMany: findUsers },
            staffMember: { findUnique: findStaff },
            payment: { count: jest.fn() },
            workEngagement: { findMany: jest.fn().mockResolvedValue([]), findFirst: findDispute },
          },
        },
        { provide: UsersService, useValue: users },
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

  function server(): App {
    return app.getHttpServer() as App;
  }

  function asStaff() {
    findUser.mockResolvedValue(null);
    findStaff.mockResolvedValue({
      subjectId: STAFF_ID,
      role: StaffRole.operator,
      status: StaffMembershipStatus.active,
    });
  }

  it('rejects a missing token', async () => {
    const response = await request(server()).get('/api/v1/admin/session');
    expect(response.status).toBe(401);
  });

  it('rejects a bad signature, audience, issuer, and expiry on the JWKS strategy path', async () => {
    const badSignature = `${signToken(STAFF_ID)}x`;
    const forgedAudience = jwt.sign(
      { sub: STAFF_ID, role: 'authenticated' },
      keys().privatePem,
      { algorithm: 'RS256', audience: 'anon', issuer: ISSUER },
    );
    const wrongIssuer = signToken(STAFF_ID, {}, { issuer: 'https://other.example/auth/v1' });
    const expired = jwt.sign(
      { sub: STAFF_ID, role: 'authenticated', aal: 'aal2' },
      keys().privatePem,
      { algorithm: 'RS256', audience: 'authenticated', issuer: ISSUER, expiresIn: -10 },
    );

    for (const token of [badSignature, forgedAudience, wrongIssuer, expired]) {
      const response = await request(server())
        .get('/api/v1/admin/session')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
    }
  });

  it('denies an ordinary product user even with aal2 and totp', async () => {
    findUser.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
    });
    findStaff.mockResolvedValue({
      subjectId: PRODUCT_ID,
      role: StaffRole.operator,
      status: StaffMembershipStatus.active,
    });
    const response = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${signToken(PRODUCT_ID)}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(STAFF_ACCESS_DENIED);
  });

  it('keeps a missing-profile non-staff identity off product routes', async () => {
    findUser.mockResolvedValue(null);
    const response = await request(server())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(MAWAHIB_PROFILE_MISSING_CODE);
  });

  it.each([
    StaffMembershipStatus.pending,
    StaffMembershipStatus.inactive,
  ])('denies %s staff', async (status) => {
    findUser.mockResolvedValue(null);
    findStaff.mockResolvedValue({
      subjectId: STAFF_ID,
      role: StaffRole.operator,
      status,
    });
    const response = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(STAFF_ACCESS_DENIED);
  });

  it('admits active dedicated staff and denies the next request after deactivation', async () => {
    asStaff();
    const ok = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ role: 'operator', membership: 'active' });

    findStaff.mockResolvedValue({
      subjectId: STAFF_ID,
      role: StaffRole.operator,
      status: StaffMembershipStatus.inactive,
    });
    const denied = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(denied.status).toBe(403);
  });

  it('denies aal1, missing aal, malformed amr, and aal2 without totp', async () => {
    asStaff();
    const cases = [
      { aal: 'aal1' },
      { aal: undefined },
      { amr: 'totp' },
      { amr: [{ method: 'password', timestamp: 1 }] },
      { amr: [{ method: 1 }] },
    ];
    for (const overrides of cases) {
      const response = await request(server())
        .get('/api/v1/admin/session')
        .set('Authorization', `Bearer ${signToken(STAFF_ID, overrides)}`);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(STAFF_ACCESS_DENIED);
    }
  });

  it('protects user and dispute reads the same way as the session check', async () => {
    const userId = '44444444-4444-4444-8444-444444444444';
    const missing = await request(server()).get('/api/v1/admin/users?q=ada');
    expect(missing.status).toBe(401);

    findUser.mockResolvedValue({ accountStatus: AccountStatus.ACTIVE, deletedAt: null });
    const product = await request(server())
      .get(`/api/v1/admin/disputes/${userId}`)
      .set('Authorization', `Bearer ${signToken(PRODUCT_ID)}`);
    expect(product.status).toBe(403);
    expect(product.body.code).toBe(STAFF_ACCESS_DENIED);

    findUser.mockResolvedValue(null);
    findStaff.mockResolvedValue({
      subjectId: STAFF_ID,
      role: StaffRole.operator,
      status: StaffMembershipStatus.pending,
    });
    const pending = await request(server())
      .get('/api/v1/admin/users?q=ada')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(pending.status).toBe(403);

    asStaff();
    findUsers.mockResolvedValue([]);
    const listed = await request(server())
      .get('/api/v1/admin/users?q=ada@example.com')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ items: [], nextCursor: null });

    findDispute.mockResolvedValue(null);
    const missingDispute = await request(server())
      .get(`/api/v1/admin/disputes/${userId}`)
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(missingDispute.status).toBe(404);

    findStaff.mockResolvedValue({
      subjectId: STAFF_ID,
      role: StaffRole.operator,
      status: StaffMembershipStatus.inactive,
    });
    const removed = await request(server())
      .get('/api/v1/admin/disputes')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(removed.status).toBe(403);

    const statusChange = await request(server())
      .post(`/api/v1/admin/users/${userId}/account-status`)
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`)
      .send({ status: 'SUSPENDED', expectedStatus: 'ACTIVE', reason: 'review' });
    expect(statusChange.status).toBe(403);

    const history = await request(server())
      .get('/api/v1/admin/account-actions')
      .set('Authorization', `Bearer ${signToken(PRODUCT_ID)}`);
    expect(history.status).toBe(403);
  });

  it('accepts a synthetic refreshed token that still carries aal2 and totp', async () => {
    asStaff();
    const token = signToken(STAFF_ID, {
      aal: 'aal2',
      amr: [
        { method: 'token_refresh', timestamp: 30 },
        { method: 'totp', timestamp: 10 },
        { method: 'password', timestamp: 1 },
      ],
    });
    const response = await request(server())
      .get('/api/v1/admin/session')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: 'operator', membership: 'active' });
  });

  it('protects the operations summary and ignores a caller-selected target', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('providers are not called'));
    const missing = await request(server()).get('/api/v1/admin/operations?url=https://evil.example');
    expect(missing.status).toBe(401);

    findUser.mockResolvedValue({ accountStatus: AccountStatus.ACTIVE, deletedAt: null });
    const product = await request(server())
      .get('/api/v1/admin/operations')
      .set('Authorization', `Bearer ${signToken(PRODUCT_ID)}`);
    expect(product.status).toBe(403);
    expect(product.body.code).toBe(STAFF_ACCESS_DENIED);

    asStaff();
    const summary = await request(server())
      .get('/api/v1/admin/operations?project=https://evil.example')
      .set('Authorization', `Bearer ${signToken(STAFF_ID)}`);
    expect(summary.status).toBe(200);
    expect(summary.body.cards.map((card: { id: string; state: string }) => [card.id, card.state])).toEqual([
      ['railway', 'not_configured'],
      ['database', 'up'],
      ['supabase_project', 'not_configured'],
      ['supabase_backup', 'not_configured'],
      ['uptime', 'not_configured'],
    ]);
    expect(JSON.stringify(summary.body)).not.toContain('evil.example');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
