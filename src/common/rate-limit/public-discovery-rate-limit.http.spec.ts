import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PublicDiscoveryRateLimitGuard } from '../guards/public-discovery-rate-limit.guard';
import { HealthController } from '../../modules/health/health.controller';
import { HealthService } from '../../modules/health/health.service';
import {
  PublicExploreController,
  PublicFeedController,
  PublicJobsController,
} from '../../modules/public/public.controller';
import { PublicService } from '../../modules/public/public.service';
import { publicCorsOptions } from '../http/public-cors';
import { PUBLIC_RATE_LIMIT_CLOCK } from '../rate-limit/public-rate-limit.constants';
import type { PublicClientAddressMode } from '../rate-limit/public-rate-limit.constants';

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

describe('public discovery rate limit HTTP', () => {
  let app: INestApplication | undefined;
  const clock = { now: 0 };
  const publicApi = {
    listFeed: jest.fn(),
    listJobs: jest.fn(),
    listExploreTalents: jest.fn(),
  };
  const health = { getHealth: jest.fn() };

  async function start(mode: PublicClientAddressMode, burst = 1, refill = 2) {
    clock.now = 0;
    jest.resetAllMocks();
    publicApi.listFeed.mockResolvedValue({ items: [{ id: 'post-1' }] });
    publicApi.listJobs.mockResolvedValue({ items: [] });
    publicApi.listExploreTalents.mockResolvedValue({ items: [] });
    health.getHealth.mockResolvedValue({ status: 'ok' });

    const config = {
      get: (key: string) =>
        ({
          PUBLIC_CLIENT_ADDRESS_MODE: mode,
          PUBLIC_RATE_BURST: burst,
          PUBLIC_RATE_REFILL_PER_SECOND: refill,
        })[key],
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicFeedController,
        PublicJobsController,
        PublicExploreController,
        HealthController,
        PrivateCanaryController,
      ],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: PUBLIC_RATE_LIMIT_CLOCK, useValue: () => clock.now },
        { provide: APP_GUARD, useClass: PublicDiscoveryRateLimitGuard },
        { provide: APP_GUARD, useClass: DenyByDefaultGuard },
        { provide: PublicService, useValue: publicApi },
        { provide: HealthService, useValue: health },
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
    app.enableCors(publicCorsOptions(['http://localhost:8081']));
    await app.init();
    expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBeFalsy();
  }

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function server(): App {
    return app!.getHttpServer() as App;
  }

  it('rejects the request after the burst and sets Retry-After through the exception filter', async () => {
    await start('socket', 2, 2);
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/feed').expect(200);

    const rejected = await request(server())
      .get('/api/v1/public/feed')
      .set('Origin', 'http://localhost:8081')
      .expect(429);

    expect(rejected.body.statusCode).toBe(429);
    expect(rejected.body.message).toBe('Too many requests. Try again shortly.');
    expect(rejected.body.path).toBe('/api/v1/public/feed');
    expect(rejected.body.retryAfter).toBeUndefined();
    expect(rejected.headers['retry-after']).toBe('1');
    expect(String(rejected.headers['access-control-expose-headers'])).toMatch(/Retry-After/);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(2);

    clock.now = 500;
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/feed').expect(429);
    clock.now = 1500;
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/feed').expect(429);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(5);
  });

  it('shares one socket budget across public discovery routes', async () => {
    await start('socket', 2, 2);
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/job-listings').expect(200);
    await request(server()).get('/api/v1/public/explore/talents').expect(429);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(1);
    expect(publicApi.listJobs).toHaveBeenCalledTimes(1);
    expect(publicApi.listExploreTalents).not.toHaveBeenCalled();
  });

  it('does not raise the limit for an Authorization header', async () => {
    await start('socket', 2, 2);
    await request(server())
      .get('/api/v1/public/feed')
      .set('Authorization', 'Bearer one')
      .expect(200);
    await request(server())
      .get('/api/v1/public/feed')
      .set('Authorization', 'Bearer two')
      .expect(200);
    await request(server())
      .get('/api/v1/public/feed')
      .set('Authorization', 'Bearer three')
      .expect(429);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(2);
  });

  it('ignores fabricated forwarding headers on a direct listener', async () => {
    await start('socket', 1, 2);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.1')
      .set('X-Forwarded-For', '203.0.113.2')
      .expect(200);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.3')
      .set('X-Forwarded-For', '203.0.113.4')
      .expect(429);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(1);
  });

  it('uses only X-Real-IP in edge mode and keeps other clients separate', async () => {
    await start('edge', 1, 2);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.1')
      .set('X-Forwarded-For', '203.0.113.2')
      .expect(200);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.1')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(429);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.9')
      .expect(200);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(2);
  });

  it('puts missing and invalid edge identities in one fallback bucket', async () => {
    await start('edge', 1, 2);
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/feed').set('X-Real-IP', 'not-an-ip').expect(429);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.1, 203.0.113.2')
      .expect(429);
    await request(server()).get('/api/v1/public/feed').set('X-Real-IP', '203.0.113.8').expect(200);
  });

  it('normalizes mapped IPv4 and equivalent IPv6 prefixes at the HTTP boundary', async () => {
    await start('edge', 1, 2);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '::ffff:203.0.113.10')
      .expect(200);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '203.0.113.10')
      .expect(429);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '2001:db8::1')
      .expect(200);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '2001:0db8:0000:0000:0000:0000:0000:0002')
      .expect(429);
    await request(server())
      .get('/api/v1/public/feed')
      .set('X-Real-IP', '2001:db8:0:1::5')
      .expect(200);
  });

  it('leaves private authorization and health outside the public budget', async () => {
    await start('socket', 1, 2);
    for (let i = 0; i < 5; i += 1) {
      await request(server()).get('/api/v1/private/canary').expect(401);
      await request(server()).get('/api/v1/health').expect(200);
    }
    await request(server())
      .options('/api/v1/public/feed')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    await request(server()).get('/api/v1/public/feed').expect(200);
    await request(server()).get('/api/v1/public/feed').expect(429);
    expect(publicApi.listFeed).toHaveBeenCalledTimes(1);
    expect(health.getHealth).toHaveBeenCalledTimes(5);
  });
});
