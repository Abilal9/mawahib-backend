/**
 * Loopback JWKS only. These tests do not call hosted Auth.
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { generateKeyPairSync, type KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  JWKS_FAILURE_BACKOFF_MS,
  JWKS_FETCH_TIMEOUT_MS,
  JWKS_FRESH_MS,
  JWKS_MAX_BODY_BYTES,
  JWKS_MAX_KEYS,
  JWKS_MAX_STALE_MS,
  JWKS_SUCCESS_GAP_MS,
  JwksDocumentCache,
  passportDocumentSecret,
} from './jwks-document';

const ISSUER = 'https://product-test.supabase.co/auth/v1';
const STAFF_ISSUER = 'https://staff-test.supabase.co/auth/v1';
const AUD = 'authenticated';

function pem(key: KeyObject, type: 'pkcs8' | 'spki'): string {
  return String(key.export({ type, format: 'pem' }));
}

function jwk(key: KeyObject, kid: string, alg: string): Record<string, unknown> {
  return {
    ...(key.export({ format: 'jwk' }) as Record<string, unknown>),
    kid,
    alg,
    use: 'sig',
  };
}

function sign(
  privateKey: KeyObject,
  kid: string,
  alg: jwt.Algorithm,
  issuer: string,
  overrides: Record<string, unknown> = {},
  expiresIn = 600,
): string {
  return jwt.sign(
    { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', ...overrides },
    pem(privateKey, 'pkcs8'),
    { algorithm: alg, audience: AUD, issuer, expiresIn, keyid: kid },
  );
}

type Mode =
  | 'document'
  | 'hang'
  | 'malformed'
  | 'oversize'
  | 'status'
  | 'redirect'
  | 'empty'
  | 'duplicate'
  | 'too-many'
  | 'mismatch'
  | 'blank'
  | 'slow-body';

describe('bounded JWKS documents', () => {
  let now = 1_700_000_000_000;
  let mode: Mode = 'document';
  let documents = new Map<string, Record<string, unknown>[]>();
  let hits = new Map<string, number>();
  let server: Server;
  let base: string;
  const logs: string[] = [];

  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const rotated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const staffEc = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.on('close', () => {
        if (!res.writableEnded) res.destroy();
      });
      const path = req.url ?? '/';
      hits.set(path, (hits.get(path) ?? 0) + 1);
      if (mode === 'hang') return;
      if (mode === 'redirect') {
        res.writeHead(302, { location: `${base}/evil` });
        res.end();
        return;
      }
      if (mode === 'status') {
        res.writeHead(503);
        res.end('unavailable');
        return;
      }
      if (mode === 'malformed') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{');
        return;
      }
      if (mode === 'oversize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`{"keys":[],"pad":"${'x'.repeat(JWKS_MAX_BODY_BYTES)}"}`);
        return;
      }
      if (mode === 'blank') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '0' });
        res.end();
        return;
      }
      if (mode === 'slow-body') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"keys":');
        return;
      }
      const keys =
        mode === 'empty'
          ? []
          : mode === 'duplicate'
            ? [jwk(ec.publicKey, 'kid-a', 'ES256'), jwk(ec.publicKey, 'kid-a', 'ES256')]
            : mode === 'too-many'
              ? Array.from({ length: JWKS_MAX_KEYS + 1 }, (_item, index) =>
                  jwk(ec.publicKey, `kid-${index}`, 'ES256'),
                )
              : mode === 'mismatch'
                ? [
                    {
                      kty: 'RSA',
                      n: 'not-a-key',
                      e: 'AQAB',
                      alg: 'ES256',
                      kid: 'kid-a',
                      use: 'sig',
                    },
                  ]
                : (documents.get(path) ?? []);
      const body = JSON.stringify({ keys });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    now = 1_700_000_000_000;
    mode = 'document';
    documents = new Map([
      ['/product', [jwk(ec.publicKey, 'kid-a', 'ES256')]],
      ['/staff', [jwk(staffEc.publicKey, 'kid-a', 'ES256')]],
    ]);
    hits = new Map();
    logs.length = 0;
  });

  function cache(
    realm: 'product' | 'staff',
    path: string,
    algorithms: readonly string[],
    policy?: { timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): JwksDocumentCache {
    return new JwksDocumentCache(
      realm,
      `${base}${path}`,
      algorithms,
      () => now,
      fetchImpl,
      (message) => logs.push(message),
      policy,
    );
  }

  function productToken(kid = 'kid-a', privateKey: KeyObject = ec.privateKey): string {
    return sign(privateKey, kid, 'ES256', ISSUER);
  }

  async function verify(documentCache: JwksDocumentCache, token: string, issuer = ISSUER) {
    const key = await documentCache.publicKeyForToken(token);
    return jwt.verify(token, key, {
      algorithms: ['ES256', 'RS256'],
      audience: AUD,
      issuer,
    });
  }

  it('publishes the refresh bounds', () => {
    expect(JWKS_FRESH_MS).toBe(10 * 60 * 1000);
    expect(JWKS_SUCCESS_GAP_MS).toBe(30 * 1000);
    expect(JWKS_MAX_STALE_MS).toBe(15 * 60 * 1000);
    expect(JWKS_FETCH_TIMEOUT_MS).toBe(2_000);
    expect(JWKS_MAX_BODY_BYTES).toBe(64 * 1024);
    expect(JWKS_MAX_KEYS).toBe(16);
    expect([...JWKS_FAILURE_BACKOFF_MS]).toEqual([30_000, 60_000, 120_000, 300_000]);
  });

  it('accepts an EC key that omits alg when ES256 is allowed', async () => {
    const published = jwk(ec.publicKey, 'kid-a', 'ES256');
    delete published.alg;
    documents.set('/product', [published]);
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    await verify(documentCache, productToken());
    expect(hits.get('/product')).toBe(1);
    documentCache.close();
  });

  it('verifies a valid token locally on the second request', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const payload = await verify(documentCache, productToken());
    expect(payload).toMatchObject({ iss: ISSUER, aud: AUD });
    await verify(documentCache, productToken());
    expect(hits.get('/product')).toBe(1);
    expect(documentCache.snapshot().accepted).toBe(1);
    documentCache.close();
  });

  it('rejects a bad signature, issuer, audience, expiry, and disallowed algorithms', async () => {
    const documentCache = cache('staff', '/staff', ['ES256']);
    const token = sign(staffEc.privateKey, 'kid-a', 'ES256', STAFF_ISSUER);
    await verify(documentCache, token, STAFF_ISSUER);
    const fetches = hits.get('/staff');
    await expect(
      verify(documentCache, `${token.slice(0, -4)}aaaa`, STAFF_ISSUER),
    ).rejects.toThrow();
    expect(() =>
      jwt.verify(token, pem(staffEc.publicKey, 'spki'), {
        algorithms: ['ES256'],
        audience: 'anon',
        issuer: STAFF_ISSUER,
      }),
    ).toThrow();
    await expect(
      verify(documentCache, sign(staffEc.privateKey, 'kid-a', 'ES256', 'https://other.example/auth/v1'), STAFF_ISSUER),
    ).rejects.toThrow();
    const expired = jwt.sign(
      { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated' },
      pem(staffEc.privateKey, 'pkcs8'),
      { algorithm: 'ES256', audience: AUD, issuer: STAFF_ISSUER, expiresIn: -10, keyid: 'kid-a' },
    );
    await expect(verify(documentCache, expired, STAFF_ISSUER)).rejects.toThrow();
    await expect(
      documentCache.publicKeyForToken(
        jwt.sign({ sub: 'x' }, 'shared-secret', {
          algorithm: 'HS256',
          audience: AUD,
          issuer: STAFF_ISSUER,
          expiresIn: 60,
        }),
      ),
    ).rejects.toThrow('Unauthorized');
    await expect(
      documentCache.publicKeyForToken(sign(rsa.privateKey, 'rsa-1', 'RS256', STAFF_ISSUER)),
    ).rejects.toThrow('Unauthorized');
    expect(hits.get('/staff')).toBe(fetches);
    documentCache.close();
  });

  it('does not follow a token-supplied key URL', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = jwt.sign(
      { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated' },
      pem(ec.privateKey, 'pkcs8'),
      {
        algorithm: 'ES256',
        audience: AUD,
        issuer: ISSUER,
        expiresIn: 60,
        keyid: 'kid-a',
        header: { alg: 'ES256', kid: 'kid-a', jku: `${base}/evil` },
      },
    );
    await verify(documentCache, token);
    expect(hits.get('/evil') ?? 0).toBe(0);
    expect(hits.get('/product')).toBe(1);
    documentCache.close();
  });

  it('serves known keys during an unknown-key flood and after the old ten-minute key expiry', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    await verify(documentCache, token);
    const unknown = Array.from({ length: 40 }, (_item, index) =>
      productToken(`attacker-kid-${index}`),
    );
    await Promise.all(
      unknown.map((item) => documentCache.publicKeyForToken(item).catch((error: Error) => error)),
    );
    expect(hits.get('/product')).toBe(1);
    expect(documentCache.snapshot().unknownKeyRejects).toBe(40);

    mode = 'status';
    now += JWKS_FRESH_MS;
    await verify(documentCache, token);
    expect(hits.get('/product')).toBe(2);
    expect(documentCache.snapshot().failures).toBe(1);
    await Promise.all(
      unknown.map((item) => documentCache.publicKeyForToken(item).catch((error: Error) => error)),
    );
    await verify(documentCache, token);
    expect(hits.get('/product')).toBe(2);
    expect(logs.every((line) => !line.includes('attacker-kid'))).toBe(true);
    documentCache.close();
  });

  it('shares one cold-start fetch across concurrent callers', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    const keys = await Promise.all(
      Array.from({ length: 25 }, () => documentCache.publicKeyForToken(token)),
    );
    expect(new Set(keys).size).toBe(1);
    expect(hits.get('/product')).toBe(1);
    documentCache.close();
  });

  it('bounds unknown-key fetches on a cold start and still verifies the real key', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    await Promise.all(
      Array.from({ length: 25 }, (_item, index) =>
        documentCache.publicKeyForToken(productToken(`missing-${index}`)).catch((error: Error) => error),
      ),
    );
    expect(hits.get('/product')).toBe(1);
    await verify(documentCache, productToken());
    expect(hits.get('/product')).toBe(1);
    documentCache.close();
  });

  it('picks up a rotated key and drops a removed key on the next fresh-window refresh', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const original = productToken();
    await verify(documentCache, original);
    documents.set('/product', [jwk(rotated.publicKey, 'kid-b', 'ES256')]);
    now += JWKS_FRESH_MS;
    const unknowns = Array.from({ length: 20 }, (_item, index) => productToken(`flood-${index}`));
    await Promise.all([
      verify(documentCache, productToken('kid-b', rotated.privateKey)),
      ...unknowns.map((item) => documentCache.publicKeyForToken(item).catch((error: Error) => error)),
    ]);
    expect(hits.get('/product')).toBe(2);
    await expect(documentCache.publicKeyForToken(original)).rejects.toThrow('Unauthorized');
    expect(hits.get('/product')).toBe(2);

    documents.set('/product', []);
    mode = 'empty';
    now += JWKS_FRESH_MS;
    await expect(documentCache.publicKeyForToken(productToken('kid-b', rotated.privateKey))).rejects.toThrow(
      'Unauthorized',
    );
    expect(documentCache.snapshot().accepted).toBe(3);
    expect(documentCache.snapshot().failures).toBe(0);
    expect(documentCache.snapshot().trustedKeys).toBe(0);
    expect(logs).toContain('product JWKS document has no allowed keys');
    expect(hits.get('/product')).toBe(3);
    documentCache.close();
  });

  it('keeps the last good document through malformed, oversized, redirect, and transport failures', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    await verify(documentCache, token);
    const modes = ['malformed', 'oversize', 'redirect', 'too-many'] as const;
    const advances = [
      JWKS_FRESH_MS,
      JWKS_FAILURE_BACKOFF_MS[0],
      JWKS_FAILURE_BACKOFF_MS[1],
      JWKS_FAILURE_BACKOFF_MS[2],
    ];
    for (let index = 0; index < modes.length; index += 1) {
      mode = modes[index];
      now += advances[index];
      await verify(documentCache, token);
    }
    expect(hits.get('/product')).toBe(5);
    expect(hits.get('/evil') ?? 0).toBe(0);
    expect(documentCache.snapshot().accepted).toBe(1);
    expect(documentCache.snapshot().failures).toBe(4);
    expect(documentCache.snapshot().trustedKeys).toBe(1);
    expect(documentCache.snapshot().lastFailure).toBe('limit');
    expect(logs.at(-1)).toBe('product JWKS refresh failed (limit)');
    expect(logs.every((line) => line.startsWith('product JWKS refresh failed'))).toBe(true);
    documentCache.close();
  });

  it('keeps the cached key through a duplicate document and a transport error inside fifteen minutes', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    await verify(documentCache, token);
    mode = 'duplicate';
    now += JWKS_FRESH_MS;
    await verify(documentCache, token);
    mode = 'status';
    now += JWKS_FAILURE_BACKOFF_MS[0];
    await verify(documentCache, token);
    expect(documentCache.snapshot().trustedKeys).toBe(1);
    expect(documentCache.snapshot().failures).toBe(2);
    documentCache.close();
  });

  it('backs off after timeout and connection failure, then recovers', async () => {
    mode = 'hang';
    const documentCache = cache('product', '/product', ['ES256', 'RS256'], { timeoutMs: 50 });
    await expect(documentCache.publicKeyForToken(productToken())).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot()).toMatchObject({ fetches: 1, failures: 1, lastFailure: 'timeout' });
    expect(documentCache.hasPendingTimer()).toBe(false);
    await expect(documentCache.publicKeyForToken(productToken())).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot().fetches).toBe(1);

    mode = 'document';
    now += JWKS_FAILURE_BACKOFF_MS[0];
    await verify(documentCache, productToken());
    expect(documentCache.snapshot().fetches).toBe(2);
    expect(documentCache.snapshot().accepted).toBe(1);

    let down = true;
    const flaky = cache(
      'staff',
      '/staff',
      ['ES256'],
      undefined,
      (input, init) => {
        if (down) return Promise.reject(new TypeError('connect ECONNREFUSED'));
        return fetch(input, init);
      },
    );
    await expect(flaky.publicKeyForToken(sign(staffEc.privateKey, 'kid-a', 'ES256', STAFF_ISSUER))).rejects.toThrow(
      'Unauthorized',
    );
    expect(flaky.snapshot().lastFailure).toBe('transport');
    down = false;
    now += JWKS_FAILURE_BACKOFF_MS[0];
    await verify(flaky, sign(staffEc.privateKey, 'kid-a', 'ES256', STAFF_ISSUER), STAFF_ISSUER);
    expect(flaky.snapshot().accepted).toBe(1);
    documentCache.close();
    flaky.close();
  });

  it('keeps the previous keys when the body is empty and removes them for an empty key set', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    await verify(documentCache, token);
    mode = 'blank';
    now += JWKS_FRESH_MS;
    await verify(documentCache, token);
    expect(documentCache.snapshot()).toMatchObject({
      accepted: 1,
      failures: 1,
      trustedKeys: 1,
      lastFailure: 'malformed',
    });

    mode = 'empty';
    now += JWKS_FAILURE_BACKOFF_MS[0];
    await expect(documentCache.publicKeyForToken(token)).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot()).toMatchObject({
      accepted: 2,
      failures: 1,
      trustedKeys: 0,
      lastFailure: null,
    });
    expect(logs).toContain('product JWKS document has no allowed keys');
    documentCache.close();
  });

  it('applies the timeout while a body is still arriving', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256'], { timeoutMs: 80 });
    const token = productToken();
    await verify(documentCache, token);
    mode = 'slow-body';
    now += JWKS_FRESH_MS;
    const started = Date.now();
    await verify(documentCache, token);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(documentCache.snapshot()).toMatchObject({
      fetches: 2,
      failures: 1,
      trustedKeys: 1,
      lastFailure: 'timeout',
    });
    expect(documentCache.hasPendingTimer()).toBe(false);
    documentCache.close();
  });

  it('drops trust when a failing fetch crosses the maximum age', async () => {
    const started = now;
    let cross = false;
    const documentCache = cache(
      'product',
      '/product',
      ['ES256', 'RS256'],
      undefined,
      async (input, init) => {
        if (cross) now = started + JWKS_MAX_STALE_MS + 1_000;
        return fetch(input, init);
      },
    );
    const token = productToken();
    await verify(documentCache, token);
    cross = true;
    mode = 'status';
    now = started + JWKS_MAX_STALE_MS - 1_000;
    await expect(verify(documentCache, token)).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot().trustedKeys).toBe(0);
    expect(documentCache.snapshot().fetches).toBe(2);
    documentCache.close();
  });

  it('drops a document that crosses the maximum age during backoff', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const started = now;
    await verify(documentCache, productToken());
    mode = 'status';
    now = started + JWKS_MAX_STALE_MS - 10_000;
    await verify(documentCache, productToken());
    expect(documentCache.snapshot().trustedKeys).toBe(1);
    const fetches = documentCache.snapshot().fetches;
    now = started + JWKS_MAX_STALE_MS + 1_000;
    await expect(verify(documentCache, productToken())).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot().fetches).toBe(fetches);
    expect(documentCache.snapshot().trustedKeys).toBe(0);
    documentCache.close();
  });

  it('rejects a non-loopback http JWKS URL and a key whose algorithm does not match its type', async () => {
    expect(
      () => new JwksDocumentCache('product', 'http://keys.example/jwks.json', ['ES256']),
    ).toThrow('JWKS URL must use https');
    const documentCache = new JwksDocumentCache(
      'product',
      'https://keys.example/jwks.json',
      ['ES256'],
      () => now,
    );
    documentCache.close();
    const live = cache('product', '/product', ['ES256', 'RS256']);
    await verify(live, productToken());
    mode = 'mismatch';
    now += JWKS_FRESH_MS;
    await verify(live, productToken());
    expect(live.snapshot().lastFailure).toBe('malformed');
    expect(live.snapshot().trustedKeys).toBe(1);
    live.close();
  });

  it('fails closed after the maximum stale age and recovers on a later successful fetch', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    await verify(documentCache, token);
    mode = 'status';
    now += JWKS_MAX_STALE_MS;
    await expect(verify(documentCache, token)).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot().fetches).toBe(2);
    await expect(verify(documentCache, token)).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot().fetches).toBe(2);

    now += JWKS_FAILURE_BACKOFF_MS[1];
    mode = 'document';
    await verify(documentCache, token);
    expect(documentCache.snapshot().fetches).toBe(3);
    expect(documentCache.snapshot().accepted).toBe(2);
    documentCache.close();
  });

  it('keeps product and staff documents independent when the key id matches', async () => {
    const productCache = cache('product', '/product', ['ES256', 'RS256']);
    const staffCache = cache('staff', '/staff', ['ES256']);
    const product = productToken();
    const staff = sign(staffEc.privateKey, 'kid-a', 'ES256', STAFF_ISSUER);
    await verify(productCache, product);
    await verify(staffCache, staff, STAFF_ISSUER);
    await Promise.all(
      Array.from({ length: 15 }, (_item, index) =>
        staffCache.publicKeyForToken(sign(staffEc.privateKey, `other-${index}`, 'ES256', STAFF_ISSUER)).catch(
          (error: Error) => error,
        ),
      ),
    );
    expect(hits.get('/product')).toBe(1);
    expect(hits.get('/staff')).toBe(1);
    const staffPem = await staffCache.publicKeyForToken(staff);
    expect(() =>
      jwt.verify(product, staffPem, { algorithms: ['ES256'], audience: AUD, issuer: ISSUER }),
    ).toThrow();
    await expect(productCache.publicKeyForToken(sign(rsa.privateKey, 'rsa-1', 'RS256', ISSUER))).rejects.toThrow();
    documents.set('/product', [jwk(rsa.publicKey, 'rsa-1', 'RS256')]);
    now += JWKS_FRESH_MS;
    const rsaToken = sign(rsa.privateKey, 'rsa-1', 'RS256', ISSUER);
    await verify(productCache, rsaToken);
    await expect(staffCache.publicKeyForToken(rsaToken)).rejects.toThrow('Unauthorized');
    expect(hits.get('/staff')).toBe(1);
    productCache.close();
    staffCache.close();
  });

  it('aborts an in-flight fetch on close and does not leave its timer running', async () => {
    mode = 'hang';
    const documentCache = cache('product', '/product', ['ES256', 'RS256'], { timeoutMs: 10_000 });
    const pending = documentCache.publicKeyForToken(productToken());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(documentCache.hasPendingTimer()).toBe(true);
    documentCache.close();
    await expect(pending).rejects.toThrow('Unauthorized');
    expect(documentCache.hasPendingTimer()).toBe(false);
    const fetches = documentCache.snapshot().fetches;
    await expect(documentCache.publicKeyForToken(productToken('kid-b'))).rejects.toThrow('Unauthorized');
    expect(documentCache.snapshot().fetches).toBe(fetches);
  });

  it('uses the passport key provider without a second fetch', async () => {
    const documentCache = cache('product', '/product', ['ES256', 'RS256']);
    const token = productToken();
    const provider = passportDocumentSecret(documentCache);
    const pemFromProvider = await new Promise<string>((resolve, reject) => {
      provider({}, token, (error, secret) => (error || !secret ? reject(error) : resolve(secret)));
    });
    expect(jwt.verify(token, pemFromProvider, { algorithms: ['ES256'], audience: AUD, issuer: ISSUER })).toMatchObject({
      sub: '11111111-1111-4111-8111-111111111111',
    });
    await new Promise<void>((resolve, reject) => {
      provider({}, token, (error) => (error ? reject(error) : resolve()));
    });
    expect(hits.get('/product')).toBe(1);
    documentCache.close();
  });
});
