import type { ClientAddressResolution } from './public-client-address';
import { PublicDiscoveryBudget } from './public-discovery-budget';

function client(key: string): ClientAddressResolution {
  return { key, identity: 'client' };
}

function budget(clock: () => number, overrides: Partial<ConstructorParameters<typeof PublicDiscoveryBudget>[0]> = {}) {
  return new PublicDiscoveryBudget({
    capacity: 16,
    refillPerSecond: 2,
    clock,
    ...overrides,
  });
}

describe('public discovery budget', () => {
  it('allows the initial burst and rejects the next request', () => {
    const limiter = budget(() => 0, { capacity: 16, refillPerSecond: 2 });
    const results = Array.from({ length: 17 }, () => limiter.consume(client('4:203.0.113.1')).allowed);
    expect(results.slice(0, 16).every(Boolean)).toBe(true);
    expect(results[16]).toBe(false);
  });

  it('refills fractional elapsed time and recovers after a full second', () => {
    const clock = { now: 0 };
    const limiter = budget(() => clock.now, { capacity: 16, refillPerSecond: 2 });
    const key = client('4:203.0.113.2');
    for (let i = 0; i < 16; i += 1) limiter.consume(key);

    clock.now = 500;
    expect(limiter.consume(key)).toMatchObject({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume(key).allowed).toBe(false);

    clock.now = 1500;
    expect(limiter.consume(key).allowed).toBe(true);
    expect(limiter.consume(key).allowed).toBe(true);
    expect(limiter.consume(key).allowed).toBe(false);
  });

  it('does not let synchronous competitors overspend the last token', async () => {
    const limiter = budget(() => 0, { capacity: 1, refillPerSecond: 1 });
    const key = client('4:203.0.113.3');
    const raced = await Promise.all([
      Promise.resolve().then(() => limiter.consume(key)),
      Promise.resolve().then(() => limiter.consume(key)),
    ]);
    expect(raced.map((result) => result.allowed).sort()).toEqual([false, true]);

    const fresh = budget(() => 0, { capacity: 1, refillPerSecond: 1 });
    const loop = Array.from({ length: 20 }, () => fresh.consume(key).allowed);
    expect(loop.filter(Boolean)).toHaveLength(1);
  });

  it('keeps distinct clients on separate budgets', () => {
    const limiter = budget(() => 0, { capacity: 1, refillPerSecond: 1 });
    expect(limiter.consume(client('4:203.0.113.4')).allowed).toBe(true);
    expect(limiter.consume(client('4:203.0.113.5')).allowed).toBe(true);
    expect(limiter.consume(client('4:203.0.113.4')).allowed).toBe(false);
  });

  it('does not refill or expire a bucket when the clock moves backward', () => {
    const clock = { now: 1000 };
    const limiter = budget(() => clock.now, { capacity: 1, refillPerSecond: 1, idleMs: 500 });
    const key = client('4:203.0.113.6');
    expect(limiter.consume(key).allowed).toBe(true);
    clock.now = 100;
    expect(limiter.consume(key).allowed).toBe(false);
    expect(limiter.trackedCount()).toBe(1);
    clock.now = 1000;
    expect(limiter.consume(key).allowed).toBe(false);
    clock.now = 2000;
    expect(limiter.consume(key).allowed).toBe(true);
  });

  it('expires idle buckets in bounded batches and does not clear the map at once', () => {
    const clock = { now: 0 };
    const limiter = budget(() => clock.now, {
      capacity: 1,
      refillPerSecond: 1,
      maxBuckets: 4,
      idleMs: 1000,
      cleanupBatch: 2,
    });
    for (const key of ['a', 'b', 'c', 'd']) {
      expect(limiter.consume(client(key)).allowed).toBe(true);
    }
    expect(limiter.trackedCount()).toBe(4);

    clock.now = 1000;
    expect(limiter.consume(client('e')).allowed).toBe(true);
    expect(limiter.trackedCount()).toBe(3);

    expect(limiter.consume(client('f')).allowed).toBe(true);
    expect(limiter.trackedCount()).toBe(2);
  });

  it('does not give a new identity a fresh bucket when the map is full', () => {
    const clock = { now: 0 };
    const limiter = budget(() => clock.now, {
      capacity: 1,
      refillPerSecond: 1,
      maxBuckets: 2,
      idleMs: 10_000,
      cleanupBatch: 2,
    });
    expect(limiter.consume(client('a')).allowed).toBe(true);
    expect(limiter.consume(client('b')).allowed).toBe(true);
    expect(limiter.trackedCount()).toBe(2);

    clock.now = 100;
    expect(limiter.consume(client('c')).allowed).toBe(true);
    expect(limiter.consume(client('d')).allowed).toBe(false);
    expect(limiter.trackedCount()).toBe(2);
    expect(limiter.consume(client('a')).allowed).toBe(false);

    const window = limiter.drainWindow();
    expect(window.overflow).toBe(2);
    expect(window.tracked).toBe(2);
    expect(JSON.stringify(window)).not.toContain('203.0.113');
  });

  it('rate-limits the shared fallback without creating client buckets', () => {
    const limiter = budget(() => 0, { capacity: 1, refillPerSecond: 1 });
    const fallback = { key: 'fallback', identity: 'fallback' as const };
    expect(limiter.consume(fallback).allowed).toBe(true);
    expect(limiter.consume(fallback).allowed).toBe(false);
    expect(limiter.trackedCount()).toBe(0);
    expect(limiter.consume(client('4:198.51.100.1')).allowed).toBe(true);
  });

  it('rejects invalid bounds', () => {
    const clock = () => 0;
    expect(() => budget(clock, { capacity: 0 })).toThrow(/burst/);
    expect(() => budget(clock, { capacity: 65 })).toThrow(/burst/);
    expect(() => budget(clock, { capacity: 1.5 })).toThrow(/burst/);
    expect(() => budget(clock, { refillPerSecond: 0 })).toThrow(/refill/);
    expect(() => budget(clock, { refillPerSecond: 21 })).toThrow(/refill/);
    expect(() => budget(clock, { maxBuckets: 4097 })).toThrow(/map size/);
  });
});
