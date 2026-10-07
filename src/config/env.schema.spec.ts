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

  it('allows the mock provider outside production', () => {
    expect(() =>
      validateEnv({ ...runtime, NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('refuses mock payments in production', () => {
    expect(() =>
      validateEnv({
        ...runtime,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
      }),
    ).toThrow(/PAYMENT_PROVIDER=mock/);
    // Default is mock, so an unset provider is refused too.
    expect(() => validateEnv({ ...runtime, NODE_ENV: 'production' })).toThrow(
      /PAYMENT_PROVIDER=mock/,
    );
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
});
