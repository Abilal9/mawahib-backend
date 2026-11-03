import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DatabaseStatus } from '../../infrastructure/database/prisma.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('GET /api/v1/health', () => {
  let app: INestApplication<App>;
  const checkConnectivity = jest.fn<Promise<DatabaseStatus>, []>();
  const getStatus = jest.fn(
    (): 'configured' | 'not_configured' => 'configured',
  );

  beforeEach(async () => {
    checkConnectivity.mockReset();
    getStatus.mockReset();
    getStatus.mockReturnValue('configured');

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { checkConnectivity } },
        { provide: SupabaseService, useValue: { getStatus } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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

  afterEach(async () => {
    await app.close();
  });

  async function getHealth() {
    return request(app.getHttpServer()).get('/api/v1/health');
  }

  function expectHealthBody(
    body: Record<string, unknown>,
    expected: {
      status: 'ok' | 'degraded';
      database: DatabaseStatus;
      supabase: string;
    },
  ) {
    expect(body).toEqual({
      status: expected.status,
      service: 'mawahib-backend',
      timestamp: expect.any(String),
      database: expected.database,
      supabase: expected.supabase,
    });
    expect(body.statusCode).toBeUndefined();
    expect(body.message).toBeUndefined();
    expect(body.path).toBeUndefined();
  }

  it('returns HTTP 200 and the health body when ready', async () => {
    checkConnectivity.mockResolvedValue('connected');

    const response = await getHealth();

    expect(response.status).toBe(200);
    expectHealthBody(response.body, {
      status: 'ok',
      database: 'connected',
      supabase: 'configured',
    });
  });

  it.each([
    ['disconnected', 'configured'],
    ['not_configured', 'configured'],
  ] as const)(
    'returns HTTP 503 and the health body when the database is %s',
    async (database, supabase) => {
      checkConnectivity.mockResolvedValue(database);
      getStatus.mockReturnValue(supabase);

      const response = await getHealth();

      expect(response.status).toBe(503);
      expectHealthBody(response.body, {
        status: 'degraded',
        database,
        supabase,
      });
    },
  );

  it('returns HTTP 503 and the health body when the supabase client is missing', async () => {
    checkConnectivity.mockResolvedValue('connected');
    getStatus.mockReturnValue('not_configured');

    const response = await getHealth();

    expect(response.status).toBe(503);
    expectHealthBody(response.body, {
      status: 'degraded',
      database: 'connected',
      supabase: 'not_configured',
    });
  });
});
