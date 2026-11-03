import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  it('GET /api/v1/health pairs the body with the HTTP status', async () => {
    // This boots the real application. ok/200 or degraded/503 only checks
    // that pairing. A degraded result does not show the app is ready.
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    const body = res.body as {
      status: string;
      service: string;
      database: string;
      supabase: string;
    };

    expect(['ok', 'degraded']).toContain(body.status);
    expect(res.status).toBe(body.status === 'ok' ? 200 : 503);
    expect(body.service).toBe('mawahib-backend');
    expect(['connected', 'disconnected', 'not_configured']).toContain(
      body.database,
    );
    expect(['configured', 'not_configured']).toContain(body.supabase);
    if (body.status === 'ok') {
      expect(body.database).toBe('connected');
      expect(body.supabase).toBe('configured');
    }
  });

  afterEach(async () => {
    await app.close();
  });
});
