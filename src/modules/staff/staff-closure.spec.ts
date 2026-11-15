import { staffClosurePaymentRefusal } from './staff-closure';

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
