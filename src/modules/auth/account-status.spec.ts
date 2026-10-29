jest.mock('jwks-rsa', () => ({
  passportJwtSecret: () => () => undefined,
}));

import {
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ACCOUNT_UNAVAILABLE_CODE,
  MAWAHIB_PROFILE_MISSING_CODE,
} from '../../common/auth/admission.codes';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HealthController } from '../health/health.controller';
import { HealthService } from '../health/health.service';
import { MediaController } from '../media/media.controller';
import { MediaService } from '../media/media.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { TaxonomyController } from '../taxonomy/taxonomy.controller';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import {
  ACCOUNT_SUSPENDED_CODE,
  JwtStrategy,
  isRecoveryJwt,
} from './strategies/jwt.strategy';
import { UsersController } from '../users/users.controller';

const SECRET = 'account-status-test-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function signToken(
  sub: string,
  overrides: Record<string, unknown> = {},
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      sub,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 600,
      ...overrides,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('recovery JWT detection', () => {
  it('treats Supabase amr recovery method as recovery', () => {
    expect(isRecoveryJwt({ amr: [{ method: 'recovery', timestamp: 1 }] })).toBe(
      true,
    );
    expect(isRecoveryJwt({ amr: ['recovery'] })).toBe(true);
    expect(isRecoveryJwt({ amr: [{ method: 'password', timestamp: 1 }] })).toBe(
      false,
    );
    expect(isRecoveryJwt({})).toBe(false);
  });
});

describe('account status enforcement', () => {
  let app: INestApplication;
  const findUnique = jest.fn<
    Promise<{ accountStatus: AccountStatus; deletedAt: Date | null } | null>,
    [
      {
        where: { id: string };
        select: { accountStatus: true; deletedAt: true };
      },
    ]
  >();
  const users = {
    getMe: jest.fn(),
    bootstrap: jest.fn(),
    updateMe: jest.fn(),
  };
  const taxonomy = { list: jest.fn(), suggest: jest.fn() };
  const media = {
    createUploadSession: jest.fn(),
    completeUpload: jest.fn(),
    getOwnedAsset: jest.fn(),
  };
  const payments = {
    createPayment: jest.fn(),
    getPayment: jest.fn(),
  };

  beforeEach(async () => {
    findUnique.mockReset();
    users.getMe.mockReset().mockResolvedValue({ id: USER_ID });
    users.bootstrap.mockReset().mockResolvedValue({ id: USER_ID });
    users.updateMe.mockReset();
    taxonomy.list.mockReset().mockResolvedValue({ categories: [] });
    taxonomy.suggest.mockReset().mockResolvedValue([]);
    media.getOwnedAsset.mockReset().mockResolvedValue({ id: USER_ID });
    media.createUploadSession.mockReset();
    media.completeUpload.mockReset();
    payments.getPayment.mockReset().mockResolvedValue({ id: USER_ID });
    payments.createPayment.mockReset();

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        HealthController,
        AuthController,
        UsersController,
        TaxonomyController,
        MediaController,
        PaymentsController,
      ],
      providers: [
        JwtAuthGuard,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'SUPABASE_JWT_SECRET' ? SECRET : undefined,
          },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique } },
        },
        { provide: UsersService, useValue: users },
        { provide: TaxonomyService, useValue: taxonomy },
        { provide: MediaService, useValue: media },
        { provide: PaymentsService, useValue: payments },
        {
          provide: HealthService,
          useValue: {
            getHealth: jest.fn().mockResolvedValue({ status: 'ok' }),
          },
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

  function authed(sub = USER_ID) {
    return { Authorization: `Bearer ${signToken(sub)}` };
  }

  function server(): App {
    return app.getHttpServer() as App;
  }

  function apiBody(response: { body: unknown }): {
    statusCode?: number;
    code?: string;
    message?: string;
    status?: string;
  } {
    return response.body as {
      statusCode?: number;
      code?: string;
      message?: string;
      status?: string;
    };
  }

  it('allows an ACTIVE user through representative routes', async () => {
    findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
    });

    await request(server()).get('/api/v1/users/me').set(authed()).expect(200);
    await request(server()).get('/api/v1/taxonomy').set(authed()).expect(200);
    await request(server())
      .get(`/api/v1/media/${USER_ID}`)
      .set(authed())
      .expect(200);
    await request(server())
      .get(`/api/v1/payments/${USER_ID}`)
      .set(authed())
      .expect(200);

    expect(users.getMe).toHaveBeenCalledTimes(1);
    expect(taxonomy.list).toHaveBeenCalledTimes(1);
    expect(media.getOwnedAsset).toHaveBeenCalledTimes(1);
    expect(payments.getPayment).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { accountStatus: true, deletedAt: true },
    });
  });

  it('denies a SUSPENDED user before controller work', async () => {
    findUnique.mockResolvedValue({
      accountStatus: AccountStatus.SUSPENDED,
      deletedAt: null,
    });

    const routes: Array<() => request.Test> = [
      () => request(server()).get('/api/v1/users/me'),
      () =>
        request(server())
          .post('/api/v1/auth/bootstrap')
          .send({ accountType: 'talent', displayName: 'Ada' }),
      () => request(server()).get('/api/v1/taxonomy'),
      () => request(server()).get(`/api/v1/media/${USER_ID}`),
      () => request(server()).get(`/api/v1/payments/${USER_ID}`),
    ];

    for (const call of routes) {
      const response = await call().set(authed()).expect(403);
      expect(response.body).toMatchObject({
        statusCode: 403,
        code: ACCOUNT_SUSPENDED_CODE,
        message: 'This account is suspended.',
      });
    }

    expect(users.getMe).not.toHaveBeenCalled();
    expect(users.bootstrap).not.toHaveBeenCalled();
    expect(users.updateMe).not.toHaveBeenCalled();
    expect(taxonomy.list).not.toHaveBeenCalled();
    expect(media.getOwnedAsset).not.toHaveBeenCalled();
    expect(media.createUploadSession).not.toHaveBeenCalled();
    expect(payments.getPayment).not.toHaveBeenCalled();
    expect(payments.createPayment).not.toHaveBeenCalled();
  });

  it('still denies a soft-deleted SUSPENDED row', async () => {
    findUnique.mockResolvedValue({
      accountStatus: AccountStatus.SUSPENDED,
      deletedAt: new Date(),
    });

    const response = await request(server())
      .post('/api/v1/auth/bootstrap')
      .set(authed())
      .send({})
      .expect(403);

    expect(apiBody(response).code).toBe(ACCOUNT_SUSPENDED_CODE);
    expect(users.bootstrap).not.toHaveBeenCalled();
    const query = findUnique.mock.calls[0]?.[0];
    if (!query) throw new Error('status query was not recorded');
    expect(query.where).toEqual({ id: USER_ID });
    expect(query.where).not.toHaveProperty('deletedAt');
  });

  it('returns MAWAHIB_PROFILE_MISSING on /users/me and allows bootstrap', async () => {
    findUnique.mockResolvedValue(null);

    const missing = await request(server())
      .get('/api/v1/users/me')
      .set(authed())
      .expect(401);
    expect(apiBody(missing).code).toBe(MAWAHIB_PROFILE_MISSING_CODE);
    expect(users.getMe).not.toHaveBeenCalled();

    await request(server())
      .get(`/api/v1/payments/${USER_ID}`)
      .set(authed())
      .expect(401);
    expect(payments.getPayment).not.toHaveBeenCalled();

    await request(server())
      .post('/api/v1/auth/bootstrap')
      .set(authed())
      .send({})
      .expect(201);
    expect(users.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('denies a deleted ACTIVE row on product routes and bootstrap', async () => {
    findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: new Date(),
    });

    const me = await request(server())
      .get('/api/v1/users/me')
      .set(authed())
      .expect(401);
    expect(apiBody(me).code).toBe(ACCOUNT_UNAVAILABLE_CODE);
    expect(apiBody(me).code).not.toBe(MAWAHIB_PROFILE_MISSING_CODE);
    expect(users.getMe).not.toHaveBeenCalled();

    const boot = await request(server())
      .post('/api/v1/auth/bootstrap')
      .set(authed())
      .send({})
      .expect(401);
    expect(apiBody(boot).code).toBe(ACCOUNT_UNAVAILABLE_CODE);
    expect(users.bootstrap).not.toHaveBeenCalled();
  });

  it('rejects a recovery JWT on product routes and bootstrap', async () => {
    findUnique.mockResolvedValue(null);
    const recovery = {
      Authorization: `Bearer ${signToken(USER_ID, {
        amr: [{ method: 'recovery', timestamp: 1 }],
      })}`,
    };

    await request(server()).get('/api/v1/users/me').set(recovery).expect(401);
    await request(server())
      .post('/api/v1/auth/bootstrap')
      .set(recovery)
      .send({})
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(users.getMe).not.toHaveBeenCalled();
    expect(users.bootstrap).not.toHaveBeenCalled();
  });

  it('rejects missing Authorization on private endpoints', async () => {
    await request(server()).get('/api/v1/users/me').expect(401);
    await request(server()).get(`/api/v1/payments/${USER_ID}`).expect(401);
    expect(users.getMe).not.toHaveBeenCalled();
    expect(payments.getPayment).not.toHaveBeenCalled();
  });

  it('keeps an invalid JWT as 401', async () => {
    findUnique.mockResolvedValue({
      accountStatus: AccountStatus.SUSPENDED,
      deletedAt: null,
    });

    await request(server())
      .get('/api/v1/users/me')
      .set({ Authorization: 'Bearer not-a-jwt' })
      .expect(401);
    await request(server())
      .get('/api/v1/users/me')
      .set({
        Authorization: `Bearer ${signToken(USER_ID, { exp: Math.floor(Date.now() / 1000) - 60 })}`,
      })
      .expect(401);

    expect(findUnique).not.toHaveBeenCalled();
    expect(users.getMe).not.toHaveBeenCalled();
  });

  it('fails closed when the status lookup fails', async () => {
    findUnique.mockRejectedValue(new Error('database unavailable'));

    const response = await request(server())
      .get('/api/v1/users/me')
      .set(authed())
      .expect(500);

    expect(apiBody(response).code).not.toBe(ACCOUNT_SUSPENDED_CODE);
    expect(apiBody(response).statusCode).toBe(500);
    expect(users.getMe).not.toHaveBeenCalled();
  });

  it('does not stamp ACCOUNT_SUSPENDED on an ownership 403', async () => {
    findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
    });
    media.getOwnedAsset.mockRejectedValue(
      new ForbiddenException('You do not own this file'),
    );

    const response = await request(server())
      .get(`/api/v1/media/${USER_ID}`)
      .set(authed())
      .expect(403);

    expect(apiBody(response).statusCode).toBe(403);
    expect(apiBody(response).code).toBeUndefined();
    expect(media.getOwnedAsset).toHaveBeenCalledTimes(1);
  });

  it('leaves health public', async () => {
    const response = await request(server()).get('/api/v1/health').expect(200);

    expect(apiBody(response).status).toBe('ok');
    expect(findUnique).not.toHaveBeenCalled();

    const malformed = await request(server())
      .get('/api/v1/health')
      .set({ Authorization: 'Bearer not-a-jwt' })
      .expect(200);
    expect(apiBody(malformed).status).toBe('ok');
    expect(findUnique).not.toHaveBeenCalled();
  });
});
