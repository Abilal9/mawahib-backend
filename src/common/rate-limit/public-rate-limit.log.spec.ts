import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PublicDiscoveryRateLimit } from '../decorators/public-discovery-rate-limit.decorator';
import { PublicDiscoveryRateLimitGuard } from '../guards/public-discovery-rate-limit.guard';
import {
  formatPublicRateLimitLog,
  PublicRateLimitLogPump,
} from './public-discovery-budget';
import type { PublicRateLimitWindow } from './public-discovery-budget';

describe('public rate-limit log', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits one aggregated line and stops with the pump', () => {
    jest.useFakeTimers();
    const logs: string[] = [];
    let window: PublicRateLimitWindow = {
      allowed: 4,
      rejected: 2,
      fallback: 1,
      overflow: 0,
      tracked: 3,
    };
    const pump = new PublicRateLimitLogPump(
      () => {
        const snapshot = window;
        window = { allowed: 0, rejected: 0, fallback: 0, overflow: 0, tracked: snapshot.tracked };
        return snapshot;
      },
      (line) => logs.push(line),
      60_000,
    );
    pump.start();
    jest.advanceTimersByTime(60_000);
    expect(logs).toEqual([
      'public discovery rate limit allowed=4 rejected=2 fallback=1 overflow=0 tracked=3',
    ]);
    expect(logs[0]).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    jest.advanceTimersByTime(60_000);
    expect(logs).toHaveLength(1);
    pump.stop();
    window = { allowed: 0, rejected: 9, fallback: 0, overflow: 1, tracked: 3 };
    jest.advanceTimersByTime(60_000);
    expect(logs).toHaveLength(1);
  });

  it('skips a line when nothing was rejected, missing, or overflowed', () => {
    expect(
      formatPublicRateLimitLog({
        allowed: 10,
        rejected: 0,
        fallback: 0,
        overflow: 0,
        tracked: 2,
      }),
    ).toBeNull();
  });

  it('stops the guard interval on module destroy', () => {
    jest.useFakeTimers();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const guard = new PublicDiscoveryRateLimitGuard(
      new Reflector(),
      {
        get: (key: string) =>
          ({
            PUBLIC_CLIENT_ADDRESS_MODE: 'socket',
            PUBLIC_RATE_BURST: 1,
            PUBLIC_RATE_REFILL_PER_SECOND: 1,
          })[key],
      } as ConfigService,
      () => 0,
    );
    class Limited {
      @PublicDiscoveryRateLimit()
      hit(): void {
        return undefined;
      }
    }
    const context = {
      getHandler: () => Limited.prototype.hit,
      getClass: () => Limited,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          headers: { 'x-real-ip': '203.0.113.50', 'x-forwarded-for': '198.51.100.50' },
          socket: { remoteAddress: '127.0.0.1' },
        }),
      }),
    };
    expect(guard.canActivate(context as never)).toBe(true);
    expect(() => guard.canActivate(context as never)).toThrow(/Too many requests/);
    jest.advanceTimersByTime(60_000);
    const limitedLogs = log.mock.calls.map((call) => String(call[0]));
    expect(limitedLogs.some((line) => line.includes('rejected=1'))).toBe(true);
    expect(limitedLogs.join('\n')).not.toContain('203.0.113.50');
    guard.onModuleDestroy();
    log.mockClear();
    jest.advanceTimersByTime(120_000);
    expect(log).not.toHaveBeenCalled();
  });
});
