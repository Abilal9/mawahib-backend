import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthService,
  HEALTH_PROBE_RESPONSE_DEADLINE_MS,
} from './health.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DatabaseStatus } from '../../infrastructure/database/prisma.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('HealthService', () => {
  let service: HealthService;
  const checkConnectivity = jest.fn<Promise<DatabaseStatus>, []>();
  const getStatus = jest.fn(
    (): 'configured' | 'not_configured' => 'configured',
  );

  beforeEach(async () => {
    checkConnectivity.mockReset();
    getStatus.mockReset();
    getStatus.mockReturnValue('configured');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: { checkConnectivity },
        },
        {
          provide: SupabaseService,
          useValue: { getStatus },
        },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns ok when database and supabase are ready', async () => {
    checkConnectivity.mockResolvedValue('connected');

    const result = await service.getHealth();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('mawahib-backend');
    expect(result.database).toBe('connected');
    expect(result.supabase).toBe('configured');
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('returns degraded when the database is disconnected', async () => {
    checkConnectivity.mockResolvedValue('disconnected');

    const result = await service.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
    expect(result.supabase).toBe('configured');
  });

  it('returns degraded when the database is not configured', async () => {
    checkConnectivity.mockResolvedValue('not_configured');

    const result = await service.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('not_configured');
  });

  it('returns degraded when the supabase client is missing', async () => {
    checkConnectivity.mockResolvedValue('connected');
    getStatus.mockReturnValue('not_configured');

    const result = await service.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('connected');
    expect(result.supabase).toBe('not_configured');
  });

  it('shares one probe across concurrent calls', async () => {
    const probe = deferred<DatabaseStatus>();
    checkConnectivity.mockReturnValue(probe.promise);

    const first = service.getHealth();
    const second = service.getHealth();
    probe.resolve('connected');
    const [a, b] = await Promise.all([first, second]);

    expect(checkConnectivity).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns a bounded degraded response when the probe stalls and does not start another', async () => {
    jest.useFakeTimers();
    const probe = deferred<DatabaseStatus>();
    checkConnectivity.mockReturnValue(probe.promise);

    const first = service.getHealth();
    const second = service.getHealth();
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_RESPONSE_DEADLINE_MS);
    const [a, b] = await Promise.all([first, second]);

    expect(checkConnectivity).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({
      status: 'degraded',
      database: 'disconnected',
      supabase: 'configured',
    });
    expect(b.database).toBe('disconnected');
    expect(jest.getTimerCount()).toBe(0);

    const third = service.getHealth();
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_RESPONSE_DEADLINE_MS);
    const stalledAgain = await third;

    expect(checkConnectivity).toHaveBeenCalledTimes(1);
    expect(stalledAgain.database).toBe('disconnected');
    expect(a.database).toBe('disconnected');

    probe.resolve('connected');
    await Promise.resolve();
    expect(a.database).toBe('disconnected');
    expect(jest.getTimerCount()).toBe(0);

    checkConnectivity.mockResolvedValue('connected');
    const recovered = await service.getHealth();

    expect(checkConnectivity).toHaveBeenCalledTimes(2);
    expect(recovered).toMatchObject({
      status: 'ok',
      database: 'connected',
      supabase: 'configured',
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('lets a later request receive the original probe after an earlier response times out', async () => {
    jest.useFakeTimers();
    const probe = deferred<DatabaseStatus>();
    checkConnectivity.mockReturnValue(probe.promise);

    const early = service.getHealth();
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_RESPONSE_DEADLINE_MS);
    const timedOut = await early;

    const later = service.getHealth();
    probe.resolve('connected');
    await jest.advanceTimersByTimeAsync(0);
    const joined = await later;

    expect(checkConnectivity).toHaveBeenCalledTimes(1);
    expect(timedOut.database).toBe('disconnected');
    expect(joined).toMatchObject({
      status: 'ok',
      database: 'connected',
      supabase: 'configured',
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases a rejected probe and lets the next request recover', async () => {
    const probe = deferred<DatabaseStatus>();
    checkConnectivity.mockReturnValue(probe.promise);

    const pending = service.getHealth();
    probe.reject(new Error('probe failed'));
    const failed = await pending;

    expect(failed).toMatchObject({
      status: 'degraded',
      database: 'disconnected',
    });
    expect(checkConnectivity).toHaveBeenCalledTimes(1);

    checkConnectivity.mockResolvedValue('connected');
    const recovered = await service.getHealth();

    expect(checkConnectivity).toHaveBeenCalledTimes(2);
    expect(recovered.status).toBe('ok');
    expect(recovered.database).toBe('connected');
  });
});
