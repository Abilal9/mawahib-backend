import { staffClosurePaymentRefusal, unpaidCancellationRefusal } from './staff-closure';

describe('staff closure payment history', () => {
  it('allows no payments and mock failed, cancelled, or succeeded rows', () => {
    expect(staffClosurePaymentRefusal([])).toBeNull();
    expect(staffClosurePaymentRefusal([
      { provider: 'mock', status: 'failed' },
      { provider: 'mock', status: 'cancelled' },
      { provider: 'mock', status: 'succeeded' },
    ])).toBeNull();
  });

  it('refuses a non-mock provider and any pending or processing attempt', () => {
    expect(staffClosurePaymentRefusal([{ provider: 'stripe', status: 'succeeded' }])).toMatch(/simulated/);
    expect(staffClosurePaymentRefusal([
      { provider: 'mock', status: 'succeeded' },
      { provider: 'mock', status: 'processing' },
    ])).toMatch(/in progress/);
    expect(staffClosurePaymentRefusal([{ provider: 'mock', status: 'pending' }])).toMatch(/in progress/);
  });
});

describe('staff unpaid cancellation payment history', () => {
  const attempt = (status: string, provider = 'mock', providerReference: string | null = null) => ({
    status,
    provider,
    providerReference,
  });

  it('allows no attempts and mock failed, cancelled, or unstarted pending attempts', () => {
    expect(unpaidCancellationRefusal([])).toBeNull();
    expect(unpaidCancellationRefusal([
      attempt('failed'),
      attempt('cancelled'),
      attempt('pending'),
    ])).toBeNull();
  });

  it('refuses processing, succeeded, a provider reference, and a non-mock history', () => {
    expect(unpaidCancellationRefusal([attempt('processing')])).toMatch(/processing or has succeeded/);
    expect(unpaidCancellationRefusal([attempt('succeeded'), attempt('failed')])).toMatch(/processing or has succeeded/);
    expect(unpaidCancellationRefusal([attempt('pending', 'mock', 'provider-ref')])).toMatch(/provider reference/);
    expect(unpaidCancellationRefusal([attempt('failed', 'stripe')])).toMatch(/not supported/);
  });
});
