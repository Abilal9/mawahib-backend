import {
  PUBLIC_RATE_CLEANUP_BATCH,
  PUBLIC_RATE_IDLE_MS,
  PUBLIC_RATE_MAX_BUCKETS,
  PUBLIC_RATE_MAX_BURST,
  PUBLIC_RATE_MAX_REFILL_PER_SECOND,
  PUBLIC_RATE_MAX_RETRY_AFTER_SECONDS,
  PUBLIC_RATE_MIN_BURST,
  PUBLIC_RATE_MIN_REFILL_PER_SECOND,
} from './public-rate-limit.constants';
import type { ClientAddressResolution } from './public-client-address';

export type PublicRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type PublicRateLimitWindow = {
  allowed: number;
  rejected: number;
  fallback: number;
  overflow: number;
  tracked: number;
};

type Bucket = {
  tokens: number;
  updatedAt: number;
  lastSeen: number;
};

export type PublicDiscoveryBudgetOptions = {
  capacity: number;
  refillPerSecond: number;
  maxBuckets?: number;
  idleMs?: number;
  cleanupBatch?: number;
  clock: () => number;
};

/**
 * In-process token bucket. `consume` is synchronous so competing requests
 * on this process cannot overspend the last token.
 *
 * The clock should be monotonic. A backward step does not refill, does not
 * move a bucket's timestamps backward, and does not expire it.
 */
export class PublicDiscoveryBudget {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxBuckets: number;
  private readonly idleMs: number;
  private readonly cleanupBatch: number;
  private readonly clock: () => number;
  private readonly buckets = new Map<string, Bucket>();
  private readonly fallback: Bucket;
  private readonly overflow: Bucket;
  private iterator: IterableIterator<string> | null = null;
  private allowed = 0;
  private rejected = 0;
  private fallbackUses = 0;
  private overflowUses = 0;

  constructor(options: PublicDiscoveryBudgetOptions) {
    assertInteger(
      options.capacity,
      PUBLIC_RATE_MIN_BURST,
      PUBLIC_RATE_MAX_BURST,
      'public rate burst',
    );
    assertInteger(
      options.refillPerSecond,
      PUBLIC_RATE_MIN_REFILL_PER_SECOND,
      PUBLIC_RATE_MAX_REFILL_PER_SECOND,
      'public rate refill',
    );
    const maxBuckets = options.maxBuckets ?? PUBLIC_RATE_MAX_BUCKETS;
    const idleMs = options.idleMs ?? PUBLIC_RATE_IDLE_MS;
    const cleanupBatch = options.cleanupBatch ?? PUBLIC_RATE_CLEANUP_BATCH;
    assertInteger(maxBuckets, 1, PUBLIC_RATE_MAX_BUCKETS, 'public rate map size');
    if (!Number.isFinite(idleMs) || idleMs < 1 || idleMs > 24 * 60 * 60 * 1000) {
      throw new Error('Invalid public rate idle window');
    }
    assertInteger(cleanupBatch, 1, 32, 'public rate cleanup batch');
    if (typeof options.clock !== 'function') {
      throw new Error('Invalid public rate clock');
    }

    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.maxBuckets = maxBuckets;
    this.idleMs = idleMs;
    this.cleanupBatch = cleanupBatch;
    this.clock = options.clock;
    const now = this.clock();
    this.fallback = this.newBucket(now);
    this.overflow = this.newBucket(now);
  }

  trackedCount(): number {
    return this.buckets.size;
  }

  consume(identity: ClientAddressResolution): PublicRateLimitDecision {
    const now = this.clock();
    this.sweep(now);

    if (identity.identity === 'fallback') {
      this.fallbackUses += 1;
      return this.take(this.fallback, now);
    }

    let bucket = this.buckets.get(identity.key);
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        this.overflowUses += 1;
        return this.take(this.overflow, now);
      }
      bucket = this.newBucket(now);
      this.buckets.set(identity.key, bucket);
    }
    return this.take(bucket, now);
  }

  drainWindow(): PublicRateLimitWindow {
    const snapshot = {
      allowed: this.allowed,
      rejected: this.rejected,
      fallback: this.fallbackUses,
      overflow: this.overflowUses,
      tracked: this.buckets.size,
    };
    this.allowed = 0;
    this.rejected = 0;
    this.fallbackUses = 0;
    this.overflowUses = 0;
    return snapshot;
  }

  private newBucket(now: number): Bucket {
    return { tokens: this.capacity, updatedAt: now, lastSeen: now };
  }

  private take(bucket: Bucket, now: number): PublicRateLimitDecision {
    this.refill(bucket, now);
    if (now >= bucket.lastSeen) bucket.lastSeen = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.allowed += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    this.rejected += 1;
    const deficit = Math.max(0, 1 - bucket.tokens);
    const retryAfterSeconds = Math.min(
      PUBLIC_RATE_MAX_RETRY_AFTER_SECONDS,
      Math.max(1, Math.ceil(deficit / this.refillPerSecond)),
    );
    return { allowed: false, retryAfterSeconds };
  }

  private refill(bucket: Bucket, now: number): void {
    if (now < bucket.updatedAt) return;
    const elapsedSeconds = (now - bucket.updatedAt) / 1000;
    if (elapsedSeconds === 0) return;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSeconds * this.refillPerSecond,
    );
    bucket.updatedAt = now;
  }

  /**
   * Examines at most `cleanupBatch` entries. Idle expiry is the only way a
   * live client bucket is removed. A full map therefore sends new identities
   * to the single overflow bucket instead of deleting an exhausted one.
   */
  private sweep(now: number): void {
    if (this.buckets.size === 0) return;
    const doomed: string[] = [];
    for (let examined = 0; examined < this.cleanupBatch; examined += 1) {
      const key = this.nextKey();
      if (!key) break;
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      if (now >= bucket.lastSeen && now - bucket.lastSeen >= this.idleMs) {
        doomed.push(key);
      }
    }
    for (const key of doomed) this.buckets.delete(key);
    if (doomed.length > 0) this.iterator = null;
  }

  private nextKey(): string | null {
    if (!this.iterator) this.iterator = this.buckets.keys();
    let step = this.iterator.next();
    if (!step.done) return step.value;
    this.iterator = this.buckets.keys();
    step = this.iterator.next();
    if (step.done) {
      this.iterator = null;
      return null;
    }
    return step.value;
  }
}

function assertInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${label}`);
  }
}

export function formatPublicRateLimitLog(window: PublicRateLimitWindow): string | null {
  if (window.rejected === 0 && window.fallback === 0 && window.overflow === 0) {
    return null;
  }
  return (
    `public discovery rate limit allowed=${window.allowed} ` +
    `rejected=${window.rejected} fallback=${window.fallback} ` +
    `overflow=${window.overflow} tracked=${window.tracked}`
  );
}

export class PublicRateLimitLogPump {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly snapshot: () => PublicRateLimitWindow,
    private readonly emit: (line: string) => void,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.timer.unref?.();
  }

  flush(): void {
    const line = formatPublicRateLimitLog(this.snapshot());
    if (line) this.emit(line);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
