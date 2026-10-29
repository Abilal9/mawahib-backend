/** Default Supabase signed-read lifetime used by Mawahib. */
export const SIGNED_READ_URL_TTL_SECONDS = 60 * 60;

/**
 * Stop reusing a cached signature this long before Supabase expires it.
 * Callers still receive a URL that is valid for several minutes.
 */
export const SIGNED_READ_URL_REUSE_MARGIN_MS = 5 * 60 * 1000;

/** Bound process memory. A miss only means the next request signs again. */
export const SIGNED_READ_URL_CACHE_LIMIT = 1000;

type Entry = {
  url: string;
  expiresAtMs: number;
};

/**
 * Process-local reuse of signed read URLs.
 * The key is storage identity, not the caller. Authorization stays in the
 * service that decides the caller may see the object, before this cache is read.
 */
export class SignedReadUrlCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): string | null {
    const key = this.key(bucket, objectKey, expiresInSeconds);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() >= entry.expiresAtMs - SIGNED_READ_URL_REUSE_MARGIN_MS) {
      this.entries.delete(key);
      return null;
    }
    return entry.url;
  }

  set(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
    url: string,
  ): void {
    const ttlMs = expiresInSeconds * 1000;
    if (ttlMs <= SIGNED_READ_URL_REUSE_MARGIN_MS) return;
    const key = this.key(bucket, objectKey, expiresInSeconds);
    this.entries.delete(key);
    this.entries.set(key, {
      url,
      expiresAtMs: this.now() + ttlMs,
    });
    this.evict();
  }

  /** Best-effort drop when a stored object is removed. A new path is a new key. */
  forget(bucket: string, objectKey: string): void {
    const prefix = `${bucket}\0${objectKey}\0`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  private evict(): void {
    if (this.entries.size <= SIGNED_READ_URL_CACHE_LIMIT) return;
    for (const [key, entry] of this.entries) {
      if (this.now() >= entry.expiresAtMs - SIGNED_READ_URL_REUSE_MARGIN_MS) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size > SIGNED_READ_URL_CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }

  private key(bucket: string, objectKey: string, expiresInSeconds: number): string {
    return `${bucket}\0${objectKey}\0${expiresInSeconds}`;
  }
}
