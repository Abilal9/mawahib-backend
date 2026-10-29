jest.mock('jwks-rsa', () => ({
  passportJwtSecret: () => () => undefined,
}));

import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { MediaController } from '../media/media.controller';
import { MediaService } from '../media/media.service';
import { PublicFeedController } from './public.controller';
import { PublicService } from './public.service';

const SECRET = 'public-guard-test-secret';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const FEED = { items: [{ id: 'post-1' }], nextCursor: null };

function signToken(sub: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      sub,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 600,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('public routes with real JwtAuthGuard', () => {
  let app: INestApplication;
  const findUnique = jest.fn();
  const publicApi = { listFeed: jest.fn() };
  const media = { getOwnedAsset: jest.fn() };

  beforeEach(async () => {
    findUnique.mockReset().mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
    });
    publicApi.listFeed.mockReset().mockResolvedValue(FEED);
    media.getOwnedAsset.mockReset();

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [PublicFeedController, MediaController],
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
        { provide: PublicService, useValue: publicApi },
        { provide: MediaService, useValue: media },
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

  it('keeps public feed viewer-neutral under real APP_GUARD', async () => {
    const none = await request(server()).get('/api/v1/public/feed').expect(200);
    const a = await request(server())
      .get('/api/v1/public/feed')
      .set({ Authorization: `Bearer ${signToken(USER_A)}` })
      .expect(200);
    const b = await request(server())
      .get('/api/v1/public/feed')
      .set({ Authorization: `Bearer ${signToken(USER_B)}` })
      .expect(200);
    const malformed = await request(server())
      .get('/api/v1/public/feed')
      .set({ Authorization: 'Bearer not-a-jwt' })
      .expect(200);
    expect(none.body).toEqual(FEED);
    expect(a.body).toEqual(FEED);
    expect(b.body).toEqual(FEED);
    expect(malformed.body).toEqual(FEED);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('still requires auth for generic media signing', async () => {
    await request(server()).get(`/api/v1/media/${USER_A}`).expect(401);
    expect(media.getOwnedAsset).not.toHaveBeenCalled();
  });
});
