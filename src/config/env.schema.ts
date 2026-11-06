import { z } from 'zod';
import { assertCompatibleStaffRealm } from '../modules/staff/staff-realm';
import {
  PUBLIC_CLIENT_ADDRESS_MODES,
  PUBLIC_RATE_DEFAULT_BURST,
  PUBLIC_RATE_DEFAULT_REFILL_PER_SECOND,
  PUBLIC_RATE_MAX_BURST,
  PUBLIC_RATE_MAX_REFILL_PER_SECOND,
  PUBLIC_RATE_MIN_BURST,
  PUBLIC_RATE_MIN_REFILL_PER_SECOND,
  type PublicClientAddressMode,
} from '../common/rate-limit/public-rate-limit.constants';

const emptyToUndefined = (value: unknown) =>
  value === '' || value === undefined || value === null ? undefined : value;

const optionalNonEmptyString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const optionalBooleanDefaultFalse = z.preprocess((value) => {
  if (value === '' || value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return value;
}, z.boolean().default(false));

/**
 * Full schema. Required connectivity vars are enforced in `validateEnv`
 * when NODE_ENV is not `test` so unit tests can boot without secrets.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:8081,http://localhost:19006,http://localhost:3000,https://admin.mawahib.io',
    ),
  SUPABASE_PROJECT_ID: optionalNonEmptyString,
  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: optionalNonEmptyString,
  SUPABASE_SECRET_KEY: optionalNonEmptyString,
  // Postgres URIs may include special characters in passwords; do not use z.url().
  DATABASE_URL: optionalNonEmptyString,
  SUPABASE_JWT_SECRET: optionalNonEmptyString,
  SUPABASE_JWT_JWKS_URL: optionalUrl,
  /** Staff Auth project. Absent means staff routes stay unavailable. */
  STAFF_SUPABASE_URL: optionalUrl,
  STAFF_SUPABASE_JWKS_URL: optionalUrl,
  /**
   * DEV-ONLY: allow POST /engagements/:id/dev-start-work to move
   * pending_payment → in_progress without Phase 5 payments.
   * Always false in production (method also checks NODE_ENV).
   */
  ENABLE_DEV_START_WORK: optionalBooleanDefaultFalse,
  /**
   * Payment backend. Only `mock` exists. Outside production it defaults to
   * mock. Production must set it explicitly and, for mock, opt in below.
   */
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  /** Invoice document generator. Mock output is a watermarked test PDF. */
  INVOICE_PROVIDER: z.enum(['mock']).default('mock'),
  /**
   * Explicit permission to boot production with simulated financial
   * providers. Not implied by NODE_ENV, and not a real-money launch.
   * Does not enable ENABLE_DEV_START_WORK.
   */
  ALLOW_SIMULATED_FINANCIAL_PROVIDERS: optionalBooleanDefaultFalse,
  /**
   * How this process learns the public-discovery client address.
   * Unset becomes `socket` off Railway. On Railway an unset value refuses
   * to boot: NODE_ENV is not a network-topology signal.
   */
  PUBLIC_CLIENT_ADDRESS_MODE: z.preprocess(
    emptyToUndefined,
    z.enum(PUBLIC_CLIENT_ADDRESS_MODES).optional(),
  ),
  PUBLIC_RATE_BURST: boundedInt(
    PUBLIC_RATE_MIN_BURST,
    PUBLIC_RATE_MAX_BURST,
    PUBLIC_RATE_DEFAULT_BURST,
  ),
  PUBLIC_RATE_REFILL_PER_SECOND: boundedInt(
    PUBLIC_RATE_MIN_REFILL_PER_SECOND,
    PUBLIC_RATE_MAX_REFILL_PER_SECOND,
    PUBLIC_RATE_DEFAULT_REFILL_PER_SECOND,
  ),
});

export type Env = Omit<z.infer<typeof envSchema>, 'PUBLIC_CLIENT_ADDRESS_MODE'> & {
  PUBLIC_CLIENT_ADDRESS_MODE: PublicClientAddressMode;
};

const REQUIRED_IN_RUNTIME = [
  'SUPABASE_PROJECT_ID',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'DATABASE_URL',
] as const;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const env = parsed.data;
  let addressMode = env.PUBLIC_CLIENT_ADDRESS_MODE;
  if (!addressMode) {
    if (railwayPlatformConfigured(config)) {
      throw new Error(
        'PUBLIC_CLIENT_ADDRESS_MODE is required when Railway platform variables are present. ' +
          'Set edge for the public HTTP service, or socket for a direct listener. ' +
          'Refusing to guess from NODE_ENV.',
      );
    }
    addressMode = 'socket';
  }

  if (env.NODE_ENV === 'production') {
    assertProductionFinancialProviders(config, env);
    if (env.ENABLE_DEV_START_WORK) {
      throw new Error(
        'Refusing to start: ENABLE_DEV_START_WORK must be false when NODE_ENV=production. ' +
          'Simulated financial providers do not enable this shortcut.',
      );
    }
  }

  if (env.NODE_ENV !== 'test') {
    const missing = REQUIRED_IN_RUNTIME.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variable(s): ${missing.join(', ')}. ` +
          'Copy .env.example to .env and set values locally (never commit secrets).',
      );
    }

    const jwks =
      env.SUPABASE_JWT_JWKS_URL ??
      (env.SUPABASE_URL
        ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
        : undefined);
    if (!jwks && !env.SUPABASE_JWT_SECRET) {
      throw new Error(
        'Missing JWT verification config: set SUPABASE_JWT_JWKS_URL (preferred) or SUPABASE_JWT_SECRET.',
      );
    }

    // Prefer derived JWKS URL when not explicitly set.
    if (!env.SUPABASE_JWT_JWKS_URL && jwks) {
      env.SUPABASE_JWT_JWKS_URL = jwks;
    }
  }

  assertCompatibleStaffRealm({
    staffUrl: env.STAFF_SUPABASE_URL,
    staffJwksUrl: env.STAFF_SUPABASE_JWKS_URL,
    productUrl: env.SUPABASE_URL,
    productJwksUrl: env.SUPABASE_JWT_JWKS_URL,
  });

  return { ...env, PUBLIC_CLIENT_ADDRESS_MODE: addressMode };
}

const RAILWAY_PLATFORM_KEYS = [
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_SERVICE_ID',
] as const;

function assertProductionFinancialProviders(
  config: Record<string, unknown>,
  env: { ALLOW_SIMULATED_FINANCIAL_PROVIDERS: boolean },
): void {
  const payment = explicitProvider(config, 'PAYMENT_PROVIDER');
  const invoice = explicitProvider(config, 'INVOICE_PROVIDER');
  const simulated = payment === 'mock' || invoice === 'mock';
  if (simulated && env.ALLOW_SIMULATED_FINANCIAL_PROVIDERS !== true) {
    throw new Error(
      'Refusing to start: simulated financial providers are selected ' +
        `(PAYMENT_PROVIDER=${payment}, INVOICE_PROVIDER=${invoice}) ` +
        'while NODE_ENV=production. Set ALLOW_SIMULATED_FINANCIAL_PROVIDERS=true ' +
        'only for a controlled test. This does not enable real money movement.',
    );
  }
}

function explicitProvider(
  config: Record<string, unknown>,
  key: 'PAYMENT_PROVIDER' | 'INVOICE_PROVIDER',
): string {
  const raw = config[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      `Refusing to start: ${key} must be set explicitly when NODE_ENV=production. ` +
        'Refusing to default to a simulated provider.',
    );
  }
  return raw.trim();
}

function railwayPlatformConfigured(config: Record<string, unknown>): boolean {
  return RAILWAY_PLATFORM_KEYS.some((key) => {
    const value = config[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

function boundedInt(min: number, max: number, fallback: number) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(min).max(max).default(fallback),
  );
}

/** Safe status lines for startup logs — never includes secret values. */
export function describeEnvPresence(env: Env): string[] {
  const line = (key: string, configured: boolean) =>
    `${key}: ${configured ? 'configured' : 'missing'}`;

  return [
    line('SUPABASE_PROJECT_ID', Boolean(env.SUPABASE_PROJECT_ID)),
    line('SUPABASE_URL', Boolean(env.SUPABASE_URL)),
    line('SUPABASE_PUBLISHABLE_KEY', Boolean(env.SUPABASE_PUBLISHABLE_KEY)),
    line('SUPABASE_SECRET_KEY', Boolean(env.SUPABASE_SECRET_KEY)),
    line('DATABASE_URL', Boolean(env.DATABASE_URL)),
    line('SUPABASE_JWT_SECRET', Boolean(env.SUPABASE_JWT_SECRET)),
    line('SUPABASE_JWT_JWKS_URL', Boolean(env.SUPABASE_JWT_JWKS_URL)),
    line('ENABLE_DEV_START_WORK', env.ENABLE_DEV_START_WORK === true),
    `PAYMENT_PROVIDER: ${env.PAYMENT_PROVIDER}`,
    `INVOICE_PROVIDER: ${env.INVOICE_PROVIDER}`,
    `ALLOW_SIMULATED_FINANCIAL_PROVIDERS: ${env.ALLOW_SIMULATED_FINANCIAL_PROVIDERS}`,
    `FINANCIAL_OPERATIONS: ${
      env.PAYMENT_PROVIDER === 'mock' && env.INVOICE_PROVIDER === 'mock'
        ? 'simulated'
        : 'not-fully-simulated'
    }`,
    `PUBLIC_CLIENT_ADDRESS_MODE: ${env.PUBLIC_CLIENT_ADDRESS_MODE}`,
    `PUBLIC_RATE_BURST: ${env.PUBLIC_RATE_BURST}`,
    `PUBLIC_RATE_REFILL_PER_SECOND: ${env.PUBLIC_RATE_REFILL_PER_SECOND}`,
  ];
}
