/** Shared public-discovery budget. Fixed bounds are not caller-configurable. */
export const PUBLIC_RATE_LIMIT_MESSAGE = 'Too many requests. Try again shortly.';

export const PUBLIC_RATE_DEFAULT_BURST = 16;
export const PUBLIC_RATE_MIN_BURST = 1;
export const PUBLIC_RATE_MAX_BURST = 64;

export const PUBLIC_RATE_DEFAULT_REFILL_PER_SECOND = 2;
export const PUBLIC_RATE_MIN_REFILL_PER_SECOND = 1;
export const PUBLIC_RATE_MAX_REFILL_PER_SECOND = 20;

/** Client buckets only. Fallback and overflow live outside this map. */
export const PUBLIC_RATE_MAX_BUCKETS = 4096;
export const PUBLIC_RATE_IDLE_MS = 10 * 60 * 1000;
export const PUBLIC_RATE_CLEANUP_BATCH = 8;
export const PUBLIC_RATE_LOG_INTERVAL_MS = 60_000;
export const PUBLIC_RATE_MAX_RETRY_AFTER_SECONDS = 60;

/** Injected clock for tests. Production uses a monotonic clock. */
export const PUBLIC_RATE_LIMIT_CLOCK = 'PUBLIC_RATE_LIMIT_CLOCK';

export const PUBLIC_CLIENT_ADDRESS_MODES = ['socket', 'edge'] as const;
export type PublicClientAddressMode = (typeof PUBLIC_CLIENT_ADDRESS_MODES)[number];
