import {
  SIGNED_READ_URL_CACHE_LIMIT,
  SIGNED_READ_URL_REUSE_MARGIN_MS,
  SIGNED_READ_URL_TTL_SECONDS,
  SignedReadUrlCache,
} from './signed-read-url-cache';

describe('SignedReadUrlCache', () => {
  const ttl = SIGNED_READ_URL_TTL_SECONDS;

  it('reuses the same URL for the same bucket and object path', () => {
    let now = 1_000_000;
    const cache = new SignedReadUrlCache(() => now);
    cache.set('posts', 'user/a.jpg', ttl, 'https://cdn.example/a?token=1');
    expect(cache.get('posts', 'user/a.jpg', ttl)).toBe(
      'https://cdn.example/a?token=1',
    );
    now += 60_000;
    expect(cache.get('posts', 'user/a.jpg', ttl)).toBe(
      'https://cdn.example/a?token=1',
    );
  });

  it('mints a miss when the URL is inside the safety margin of expiry', () => {
    let now = 1_000_000;
    const cache = new SignedReadUrlCache(() => now);
    cache.set('messages', 'user/a.jpg', ttl, 'https://cdn.example/a?token=1');
    now += ttl * 1000 - SIGNED_READ_URL_REUSE_MARGIN_MS;
    expect(cache.get('messages', 'user/a.jpg', ttl)).toBeNull();
  });

  it('keeps the URL one millisecond before the safety margin', () => {
    let now = 1_000_000;
    const cache = new SignedReadUrlCache(() => now);
    cache.set('messages', 'user/a.jpg', ttl, 'https://cdn.example/a?token=1');
    now += ttl * 1000 - SIGNED_READ_URL_REUSE_MARGIN_MS - 1;
    expect(cache.get('messages', 'user/a.jpg', ttl)).toBe(
      'https://cdn.example/a?token=1',
    );
  });

  it('does not reuse a URL for a different object path or bucket', () => {
    const cache = new SignedReadUrlCache(() => 1_000_000);
    cache.set('posts', 'user/a.jpg', ttl, 'https://cdn.example/a');
    expect(cache.get('posts', 'user/b.jpg', ttl)).toBeNull();
    expect(cache.get('messages', 'user/a.jpg', ttl)).toBeNull();
  });

  it('does not cache a lifetime that is already inside the safety margin', () => {
    const cache = new SignedReadUrlCache(() => 1_000_000);
    cache.set('posts', 'user/a.jpg', 60, 'https://cdn.example/short');
    expect(cache.get('posts', 'user/a.jpg', 60)).toBeNull();
  });

  it('drops the oldest entry after the cache limit and keeps a refreshed one', () => {
    const cache = new SignedReadUrlCache(() => 1_000_000);
    cache.set('posts', '0', ttl, 'https://cdn.example/0');
    for (let index = 1; index < SIGNED_READ_URL_CACHE_LIMIT; index += 1) {
      cache.set('posts', String(index), ttl, `https://cdn.example/${index}`);
    }
    cache.set('posts', '0', ttl, 'https://cdn.example/0-fresh');
    cache.set('posts', 'extra', ttl, 'https://cdn.example/extra');
    expect(cache.get('posts', '0', ttl)).toBe('https://cdn.example/0-fresh');
    expect(cache.get('posts', '1', ttl)).toBeNull();
    expect(cache.get('posts', 'extra', ttl)).toBe('https://cdn.example/extra');
  });

  it('forgets every lifetime cached for a removed object', () => {
    const cache = new SignedReadUrlCache(() => 1_000_000);
    cache.set('posts', 'user/a.jpg', ttl, 'https://cdn.example/a');
    cache.forget('posts', 'user/a.jpg');
    expect(cache.get('posts', 'user/a.jpg', ttl)).toBeNull();
  });
});
