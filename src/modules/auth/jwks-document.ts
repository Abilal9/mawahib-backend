import { createPublicKey, type KeyObject } from 'crypto';

/**
 * One JWKS document per configured realm.
 *
 * A document is fresh for 10 minutes. Known keys are verified locally.
 * Unknown key IDs never trigger their own fetch while a document is fresh,
 * and they share the single in-flight fetch when a refresh is already due.
 *
 * After a successful fetch, another fetch waits at least 30 seconds.
 * After a failure, the next attempt waits 30s, then 60s, then 2 minutes,
 * then 5 minutes. A last-known-good document is used only until it is
 * 60 minutes old. After that, verification fails closed.
 *
 * Each fetch aborts after 2 seconds. Responses over 64 KiB, or documents
 * with more than 16 keys, are rejected. There is no background timer.
 */
export const JWKS_FRESH_MS = 10 * 60 * 1000;
export const JWKS_SUCCESS_GAP_MS = 30 * 1000;
export const JWKS_MAX_STALE_MS = 60 * 60 * 1000;
export const JWKS_FETCH_TIMEOUT_MS = 2_000;
export const JWKS_MAX_BODY_BYTES = 64 * 1024;
export const JWKS_MAX_KEYS = 16;
export const JWKS_FAILURE_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000] as const;

export type JwksDocumentPolicy = {
  freshMs: number;
  successGapMs: number;
  maxStaleMs: number;
  timeoutMs: number;
  maxBodyBytes: number;
  maxKeys: number;
  failureBackoffMs: readonly number[];
};

export const JWKS_DOCUMENT_POLICY: JwksDocumentPolicy = {
  freshMs: JWKS_FRESH_MS,
  successGapMs: JWKS_SUCCESS_GAP_MS,
  maxStaleMs: JWKS_MAX_STALE_MS,
  timeoutMs: JWKS_FETCH_TIMEOUT_MS,
  maxBodyBytes: JWKS_MAX_BODY_BYTES,
  maxKeys: JWKS_MAX_KEYS,
  failureBackoffMs: JWKS_FAILURE_BACKOFF_MS,
};

export type JwksDocumentStats = {
  fetches: number;
  accepted: number;
  failures: number;
  unknownKeyRejects: number;
  trustedKeys: number;
  lastFailure: 'timeout' | 'transport' | 'malformed' | 'status' | 'limit' | null;
};

type StoredKey = { pem: string; alg: string };
type Document = { fetchedAt: number; keys: Map<string, StoredKey> };

class JwksFetchError extends Error {
  constructor(readonly reason: JwksDocumentStats['lastFailure'] & string) {
    super('JWKS refresh failed');
  }
}

const JWK_FIELDS = ['kty', 'crv', 'x', 'y', 'n', 'e'] as const;

function headerOf(token: string): { alg?: unknown; kid?: unknown } {
  const encoded = token.split('.', 1)[0] ?? '';
  if (encoded.length < 2 || encoded.length > 4096) {
    throw new JwksFetchError('malformed');
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('header');
    }
    return parsed as { alg?: unknown; kid?: unknown };
  } catch {
    throw new JwksFetchError('malformed');
  }
}

function material(jwk: Record<string, unknown>): Record<string, string> {
  const key: Record<string, string> = {};
  for (const field of JWK_FIELDS) {
    const value = jwk[field];
    if (typeof value === 'string' && value.length > 0) key[field] = value;
  }
  return key;
}

function selectableAlg(
  jwk: Record<string, unknown>,
  algorithms: readonly string[],
): string | null {
  if (typeof jwk.alg === 'string') {
    return algorithms.includes(jwk.alg) ? jwk.alg : null;
  }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && algorithms.includes('ES256')) {
    return 'ES256';
  }
  if (jwk.kty === 'RSA' && algorithms.includes('RS256')) return 'RS256';
  return null;
}

function matchesAlgorithm(alg: string, jwk: Record<string, unknown>): boolean {
  if (alg === 'ES256') return jwk.kty === 'EC' && jwk.crv === 'P-256';
  if (alg === 'RS256') return jwk.kty === 'RSA';
  return false;
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new JwksFetchError('malformed');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new JwksFetchError('malformed');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new JwksFetchError('malformed');
    }
    chunks.push(step.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function acceptDocument(
  text: string,
  algorithms: readonly string[],
  maxKeys: number,
): Map<string, StoredKey> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JwksFetchError('malformed');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JwksFetchError('malformed');
  }
  const keys = (parsed as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) throw new JwksFetchError('malformed');
  if (keys.length > maxKeys) throw new JwksFetchError('limit');
  const accepted = new Map<string, StoredKey>();
  const seen = new Set<string>();
  for (const entry of keys) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new JwksFetchError('malformed');
    }
    const jwk = entry as Record<string, unknown>;
    const kid = jwk.kid;
    if (typeof kid !== 'string' || kid.length < 1 || kid.length > 128) {
      throw new JwksFetchError('malformed');
    }
    if (seen.has(kid)) throw new JwksFetchError('malformed');
    seen.add(kid);
    if (jwk.use !== undefined && jwk.use !== 'sig') continue;
    const alg = selectableAlg(jwk, algorithms);
    if (!alg) continue;
    if (!matchesAlgorithm(alg, jwk)) throw new JwksFetchError('malformed');
    let imported: KeyObject;
    try {
      imported = createPublicKey({ key: material(jwk), format: 'jwk' });
    } catch {
      throw new JwksFetchError('malformed');
    }
    accepted.set(kid, {
      alg,
      pem: String(imported.export({ type: 'spki', format: 'pem' })),
    });
  }
  return accepted;
}

function assertJwksUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('JWKS URL must use https');
  }
  const host = parsed.hostname.toLowerCase();
  const loopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && loopback) return;
  throw new Error('JWKS URL must use https');
}

/**
 * Fetches and remembers the JWKS document for one configured URL.
 * Signature verification stays with passport-jwt.
 */
export class JwksDocumentCache {
  private readonly policy: JwksDocumentPolicy;
  private readonly algorithms: readonly string[];
  private document: Document | null = null;
  private inFlight: Promise<void> | null = null;
  private nextAttemptAt = 0;
  private failures = 0;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly stats: JwksDocumentStats = {
    fetches: 0,
    accepted: 0,
    failures: 0,
    unknownKeyRejects: 0,
    trustedKeys: 0,
    lastFailure: null,
  };

  constructor(
    private readonly realm: 'product' | 'staff',
    private readonly url: string,
    algorithms: readonly string[],
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log?: (message: string) => void,
    policy?: Partial<JwksDocumentPolicy>,
  ) {
    assertJwksUrl(url);
    this.algorithms = [...algorithms];
    this.policy = { ...JWKS_DOCUMENT_POLICY, ...policy };
    if (this.policy.maxStaleMs <= this.policy.freshMs) {
      throw new Error('JWKS maximum age must be longer than the fresh window');
    }
    if (this.policy.failureBackoffMs.length < 1) {
      throw new Error('JWKS failure backoff is required');
    }
  }

  snapshot(): JwksDocumentStats {
    return { ...this.stats };
  }

  hasPendingTimer(): boolean {
    return this.timer !== null;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
  }

  async publicKeyForToken(token: string): Promise<string> {
    if (this.closed) throw new Error('Unauthorized');
    let header: { alg?: unknown; kid?: unknown };
    try {
      header = headerOf(token);
    } catch {
      throw new Error('Unauthorized');
    }
    if (typeof header.alg !== 'string' || !this.algorithms.includes(header.alg)) {
      throw new Error('Unauthorized');
    }
    const kid = header.kid;
    if (typeof kid !== 'string' || kid.length < 1 || kid.length > 128) {
      throw new Error('Unauthorized');
    }
    await this.ensureDocument();
    const stored = this.document?.keys.get(kid);
    if (!stored || stored.alg !== header.alg) {
      this.stats.unknownKeyRejects += 1;
      throw new Error('Unauthorized');
    }
    return stored.pem;
  }

  private async ensureDocument(): Promise<void> {
    if (this.closed) throw new Error('Unauthorized');
    const age = this.age(this.now());
    if (this.document && age < this.policy.freshMs) return;
    if (this.now() < this.nextAttemptAt) {
      if (!this.document || age >= this.policy.maxStaleMs) {
        this.retain(null);
        throw new Error('Unauthorized');
      }
      return;
    }
    await this.beginRefresh();
    if (this.closed) throw new Error('Unauthorized');
    const currentAge = this.age(this.now());
    if (!this.document || currentAge >= this.policy.maxStaleMs) {
      this.retain(null);
      throw new Error('Unauthorized');
    }
  }

  private retain(document: Document | null): void {
    this.document = document;
    this.stats.trustedKeys = document?.keys.size ?? 0;
  }

  private age(now: number): number {
    if (!this.document) return Number.POSITIVE_INFINITY;
    return now - this.document.fetchedAt;
  }

  private beginRefresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.inFlight = gate;
    void this.fetchDocument().finally(() => {
      if (this.inFlight === gate) this.inFlight = null;
      release();
    });
    return gate;
  }

  private async fetchDocument(): Promise<void> {
    if (this.closed) return;
    this.stats.fetches += 1;
    const controller = new AbortController();
    this.abort = controller;
    this.timer = setTimeout(() => controller.abort(), this.policy.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (response.status !== 200) throw new JwksFetchError('status');
      const text = await readBody(response, this.policy.maxBodyBytes);
      const keys = acceptDocument(text, this.algorithms, this.policy.maxKeys);
      if (this.closed) return;
      this.retain({ fetchedAt: this.now(), keys });
      this.failures = 0;
      this.nextAttemptAt = this.now() + this.policy.successGapMs;
      this.stats.accepted += 1;
      this.stats.lastFailure = null;
      if (keys.size === 0) {
        this.log?.(`${this.realm} JWKS document has no allowed keys`);
      }
    } catch (error) {
      if (this.closed) return;
      const reason =
        error instanceof JwksFetchError
          ? error.reason
          : controller.signal.aborted
            ? 'timeout'
            : 'transport';
      this.noteFailure(reason);
    } finally {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.abort === controller) this.abort = null;
    }
  }

  private noteFailure(reason: NonNullable<JwksDocumentStats['lastFailure']>): void {
    this.stats.failures += 1;
    this.stats.lastFailure = reason;
    const delay =
      this.policy.failureBackoffMs[
        Math.min(this.failures, this.policy.failureBackoffMs.length - 1)
      ] ?? JWKS_FAILURE_BACKOFF_MS[JWKS_FAILURE_BACKOFF_MS.length - 1];
    this.failures += 1;
    this.nextAttemptAt = this.now() + delay;
    if (this.document && this.age(this.now()) >= this.policy.maxStaleMs) {
      this.retain(null);
    }
    this.log?.(`${this.realm} JWKS refresh failed (${reason})`);
  }
}

type SecretDone = (error: Error | null, secret?: string) => void;

/** passport-jwt key provider. The URL is the cache's configured URL. */
export function passportDocumentSecret(
  cache: JwksDocumentCache,
): (request: unknown, rawJwtToken: unknown, done: SecretDone) => void {
  return (_request, rawJwtToken, done) => {
    void cache.publicKeyForToken(String(rawJwtToken ?? '')).then(
      (pem) => done(null, pem),
      () => done(new Error('Unauthorized')),
    );
  };
}
