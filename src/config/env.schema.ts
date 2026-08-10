import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  value === '' || value === undefined || value === null ? undefined : value;

const optionalNonEmptyString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

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
      'http://localhost:8081,http://localhost:19006,http://localhost:3000',
    ),
  SUPABASE_PROJECT_ID: optionalNonEmptyString,
  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: optionalNonEmptyString,
  SUPABASE_SECRET_KEY: optionalNonEmptyString,
  // Postgres URIs may include special characters in passwords; do not use z.url().
  DATABASE_URL: optionalNonEmptyString,
  SUPABASE_JWT_SECRET: optionalNonEmptyString,
  SUPABASE_JWT_JWKS_URL: optionalUrl,
});

export type Env = z.infer<typeof envSchema>;

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
  if (env.NODE_ENV !== 'test') {
    const missing = REQUIRED_IN_RUNTIME.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variable(s): ${missing.join(', ')}. ` +
          'Copy .env.example to .env and set values locally (never commit secrets).',
      );
    }
  }

  return env;
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
  ];
}
