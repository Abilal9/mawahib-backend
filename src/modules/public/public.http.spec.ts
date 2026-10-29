import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  PublicExploreController,
  PublicFeedController,
  PublicJobsController,
  PublicOfferingsController,
  PublicProfilesController,
  PublicTaxonomyController,
} from './public.controller';
import { PublicService } from './public.service';

const FEED_BODY = {
  items: [{ id: 'post-1', text: 'hello', likeCount: 0, commentCount: 0 }],
  nextCursor: null,
};

@Injectable()
class DenyByDefaultGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (isPublic) return true;
    throw new UnauthorizedException();
  }
}

@Controller('private')
class PrivateCanaryController {
  @Get('canary')
  canary() {
    return { ok: true };
  }
}

describe('public HTTP surface', () => {
  let app: INestApplication;
  const publicApi = {
    listFeed: jest.fn(),
    getPost: jest.fn(),
    getProfile: jest.fn(),
    listUserPosts: jest.fn(),
    listUserServices: jest.fn(),
    listUserPortfolio: jest.fn(),
    listUserReviews: jest.fn(),
    getService: jest.fn(),
    listServiceReviews: jest.fn(),
    listJobs: jest.fn(),
    getJob: jest.fn(),
    listExploreTalents: jest.fn(),
    listExploreServices: jest.fn(),
    listTaxonomy: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    publicApi.listFeed.mockResolvedValue(FEED_BODY);
    publicApi.listJobs.mockResolvedValue({ items: [], take: 20, skip: 0 });
    publicApi.listExploreTalents.mockResolvedValue({
      items: [],
      take: 20,
      skip: 0,
    });
    publicApi.listTaxonomy.mockResolvedValue({ categories: [] });
    publicApi.getPost.mockResolvedValue({ id: 'post-1' });
    publicApi.getProfile.mockResolvedValue({ id: 'user-1' });

    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicFeedController,
        PublicProfilesController,
        PublicOfferingsController,
        PublicJobsController,
        PublicExploreController,
        PublicTaxonomyController,
        PrivateCanaryController,
      ],
      providers: [
        DenyByDefaultGuard,
        { provide: APP_GUARD, useExisting: DenyByDefaultGuard },
        { provide: PublicService, useValue: publicApi },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function server(): App {
    return app.getHttpServer() as App;
  }

  it('serves public feed without Authorization', async () => {
    const response = await request(server()).get('/api/v1/public/feed').expect(200);
    expect(response.body).toEqual(FEED_BODY);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(1);
  });

  it('does not personalize public feed from Authorization', async () => {
    const none = await request(server()).get('/api/v1/public/feed').expect(200);
    const tokenA = await request(server())
      .get('/api/v1/public/feed')
      .set({ Authorization: 'Bearer token-a' })
      .expect(200);
    const tokenB = await request(server())
      .get('/api/v1/public/feed')
      .set({ Authorization: 'Bearer token-b' })
      .expect(200);
    const malformed = await request(server())
      .get('/api/v1/public/feed')
      .set({ Authorization: 'Bearer not-a-jwt' })
      .expect(200);
    expect(none.body).toEqual(FEED_BODY);
    expect(tokenA.body).toEqual(FEED_BODY);
    expect(tokenB.body).toEqual(FEED_BODY);
    expect(malformed.body).toEqual(FEED_BODY);
  });

  it('rejects public jobs status probing', async () => {
    await request(server())
      .get('/api/v1/public/job-listings')
      .query({ status: 'draft' })
      .expect(400);
    expect(publicApi.listJobs).not.toHaveBeenCalled();
  });

  it('caps explore take and skip', async () => {
    await request(server())
      .get('/api/v1/public/explore/talents')
      .query({ take: 9999 })
      .expect(400);
    await request(server())
      .get('/api/v1/public/explore/talents')
      .query({ skip: 999999 })
      .expect(400);
    expect(publicApi.listExploreTalents).not.toHaveBeenCalled();
  });

  it('rejects one-character search', async () => {
    await request(server())
      .get('/api/v1/public/explore/talents')
      .query({ q: 'a' })
      .expect(400);
    await request(server())
      .get('/api/v1/public/job-listings')
      .query({ q: 'a' })
      .expect(400);
  });

  it('allows two-character search', async () => {
    await request(server())
      .get('/api/v1/public/explore/talents')
      .query({ q: 'ab' })
      .expect(200);
    expect(publicApi.listExploreTalents).toHaveBeenCalled();
  });

  it('keeps unannotated private routes denied', async () => {
    await request(server()).get('/api/v1/private/canary').expect(401);
  });

  it('serves public taxonomy anonymously', async () => {
    await request(server()).get('/api/v1/public/taxonomy').expect(200);
    expect(publicApi.listTaxonomy).toHaveBeenCalled();
  });
});
