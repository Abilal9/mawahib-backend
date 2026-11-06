import { validateEnv } from './env.schema';

describe('validateEnv payment provider guard', () => {
  const runtime = {
    SUPABASE_PROJECT_ID: 'proj',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_SECRET_KEY: 'secret',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  };

  it('defaults providers to mock', () => {
    const env = validateEnv({ NODE_ENV: 'test' });
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.INVOICE_PROVIDER).toBe('mock');
  });

  it('allows the staff portal origin without dropping localhost', () => {
    const origins = validateEnv({ NODE_ENV: 'test' }).CORS_ORIGINS.split(',');
    expect(origins).toContain('http://localhost:8081');
    expect(origins).toContain('http://localhost:19006');
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('https://admin.mawahib.io');
    expect(origins).not.toContain('*');
  });

  it('allows the mock provider outside production', () => {
    expect(() =>
      validateEnv({ ...runtime, NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('refuses simulated providers in production without an explicit opt-in', () => {
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        INVOICE_PROVIDER: 'mock',
      }),
    ).toThrow(/ALLOW_SIMULATED_FINANCIAL_PROVIDERS=true/);
    expect(() => validateEnv({ ...runtime, NODE_ENV: 'production' })).toThrow(
      /PAYMENT_PROVIDER must be set explicitly/,
    );
  });

  it('boots production when both simulated providers and the opt-in are explicit', () => {
    const env = validateEnv({
      ...runtime,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'mock',
      INVOICE_PROVIDER: 'mock',
      ALLOW_SIMULATED_FINANCIAL_PROVIDERS: 'true',
    });
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.INVOICE_PROVIDER).toBe('mock');
    expect(env.ALLOW_SIMULATED_FINANCIAL_PROVIDERS).toBe(true);
    expect(env.ENABLE_DEV_START_WORK).toBe(false);
  });

  it('does not let the simulation opt-in enable the dev start-work shortcut', () => {
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        INVOICE_PROVIDER: 'mock',
        ALLOW_SIMULATED_FINANCIAL_PROVIDERS: 'true',
        ENABLE_DEV_START_WORK: 'true',
      }),
    ).toThrow(/ENABLE_DEV_START_WORK must be false/);
  });

  it('rejects a partial production provider selection and invalid opt-in values', () => {
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_SIMULATED_FINANCIAL_PROVIDERS: 'true',
      }),
    ).toThrow(/INVOICE_PROVIDER must be set explicitly/);
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        INVOICE_PROVIDER: 'mock',
        ALLOW_SIMULATED_FINANCIAL_PROVIDERS: 'yes',
      }),
    ).toThrow(/ALLOW_SIMULATED_FINANCIAL_PROVIDERS/);
  });

  it('rejects unknown providers', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'stripe' }),
    ).toThrow(/PAYMENT_PROVIDER/);
  });

  it('keeps ENABLE_DEV_START_WORK parsing', () => {
    expect(
      validateEnv({ NODE_ENV: 'test', ENABLE_DEV_START_WORK: 'true' })
        .ENABLE_DEV_START_WORK,
    ).toBe(true);
  });

  it('defaults the public limiter to a direct socket listener', () => {
    const env = validateEnv({ NODE_ENV: 'test' });
    expect(env.PUBLIC_CLIENT_ADDRESS_MODE).toBe('socket');
    expect(env.PUBLIC_RATE_BURST).toBe(16);
    expect(env.PUBLIC_RATE_REFILL_PER_SECOND).toBe(2);
    expect(
      validateEnv({ ...runtime, NODE_ENV: 'development' }).PUBLIC_CLIENT_ADDRESS_MODE,
    ).toBe('socket');
  });

  it('accepts an explicit edge mode and rejects invalid limiter settings', () => {
    expect(
      validateEnv({ NODE_ENV: 'test', PUBLIC_CLIENT_ADDRESS_MODE: 'edge' })
        .PUBLIC_CLIENT_ADDRESS_MODE,
    ).toBe('edge');
    expect(() =>
      validateEnv({ NODE_ENV: 'test', PUBLIC_CLIENT_ADDRESS_MODE: 'forwarded' }),
    ).toThrow(/PUBLIC_CLIENT_ADDRESS_MODE/);
    expect(() => validateEnv({ NODE_ENV: 'test', PUBLIC_RATE_BURST: '0' })).toThrow(
      /PUBLIC_RATE_BURST/,
    );
    expect(() => validateEnv({ NODE_ENV: 'test', PUBLIC_RATE_BURST: '65' })).toThrow(
      /PUBLIC_RATE_BURST/,
    );
    expect(() => validateEnv({ NODE_ENV: 'test', PUBLIC_RATE_BURST: '1.5' })).toThrow(
      /PUBLIC_RATE_BURST/,
    );
    expect(() =>
      validateEnv({ NODE_ENV: 'test', PUBLIC_RATE_REFILL_PER_SECOND: '0' }),
    ).toThrow(/PUBLIC_RATE_REFILL_PER_SECOND/);
    expect(() =>
      validateEnv({ NODE_ENV: 'test', PUBLIC_RATE_REFILL_PER_SECOND: '21' }),
    ).toThrow(/PUBLIC_RATE_REFILL_PER_SECOND/);
  });

  it('refuses to guess the address mode when Railway platform variables are present', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'test',
        RAILWAY_SERVICE_ID: 'svc-test',
      }),
    ).toThrow(/PUBLIC_CLIENT_ADDRESS_MODE/);
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'production',
      }),
    ).toThrow(/Refusing to guess from NODE_ENV/);
    expect(
      validateEnv({
        NODE_ENV: 'test',
        RAILWAY_SERVICE_ID: 'svc-test',
        PUBLIC_CLIENT_ADDRESS_MODE: 'edge',
      }).PUBLIC_CLIENT_ADDRESS_MODE,
    ).toBe('edge');
    expect(
      validateEnv({
        NODE_ENV: 'test',
        RAILWAY_PROJECT_ID: '   ',
      }).PUBLIC_CLIENT_ADDRESS_MODE,
    ).toBe('socket');
  });

  it('starts without staff auth settings', () => {
    expect(validateEnv({ ...runtime, NODE_ENV: 'development' }).STAFF_SUPABASE_URL).toBeUndefined();
  });

  it('rejects a malformed or partial staff realm without using it', () => {
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'development',
        STAFF_SUPABASE_URL: 'not a url',
      }),
    ).toThrow(/STAFF_SUPABASE_URL/);
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'development',
        STAFF_SUPABASE_JWKS_URL: 'https://staff.supabase.co/auth/v1/.well-known/jwks.json',
      }),
    ).toThrow(/STAFF_SUPABASE_URL/);
  });

  it('rejects a staff realm that repeats the product realm', () => {
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'development',
        STAFF_SUPABASE_URL: 'https://proj.supabase.co',
      }),
    ).toThrow(/different issuer and JWKS/);
  });
});
