import { BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import {
  MOCK_PAYMENT_TOKENS,
  MockPaymentProvider,
} from './mock-payment.provider';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  const run = async (method: PaymentMethod, methodToken: string) => {
    const created = await provider.createPayment({
      amount: '10.00',
      currency: 'SAR',
      method,
      methodToken,
      idempotencyKey: 'idem-key-0001',
      metadata: { paymentId: 'p', engagementId: 'e' },
    });
    const confirmed = await provider.confirmPayment({
      providerReference: created.providerReference,
      method,
      methodToken,
    });
    return { created, confirmed };
  };

  it('knows exactly the documented tokens', () => {
    expect(Object.keys(MOCK_PAYMENT_TOKENS).sort()).toEqual([
      'mock_apple_pay_declined',
      'mock_apple_pay_success',
      'mock_card_declined',
      'mock_mastercard_success',
      'mock_visa_success',
    ]);
  });

  it.each([
    [PaymentMethod.card, 'mock_visa_success'],
    [PaymentMethod.card, 'mock_mastercard_success'],
    [PaymentMethod.apple_pay, 'mock_apple_pay_success'],
  ])('succeeds for %s / %s', async (method, token) => {
    const { created, confirmed } = await run(method, token);
    expect(created.providerReference).toMatch(/^mock_pay_[a-f0-9]{32}$/);
    expect(created.status).toBe('requires_confirmation');
    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.providerReference).toBe(created.providerReference);
  });

  it.each([
    [PaymentMethod.card, 'mock_card_declined', 'card_declined'],
    [PaymentMethod.apple_pay, 'mock_apple_pay_declined', 'apple_pay_declined'],
  ])('declines for %s / %s', async (method, token, code) => {
    const { confirmed } = await run(method, token);
    expect(confirmed.status).toBe('failed');
    expect(confirmed.failureCode).toBe(code);
    expect(confirmed.failureMessage).toBeTruthy();
  });

  it('generates a distinct reference per payment', async () => {
    const a = await run(PaymentMethod.card, 'mock_visa_success');
    const b = await run(PaymentMethod.card, 'mock_visa_success');
    expect(a.created.providerReference).not.toBe(b.created.providerReference);
  });

  it('rejects unknown tokens and mismatched methods', () => {
    expect(() => provider.validateMethod(PaymentMethod.card, 'nope')).toThrow(
      BadRequestException,
    );
    expect(() =>
      provider.validateMethod(PaymentMethod.apple_pay, 'mock_visa_success'),
    ).toThrow(BadRequestException);
  });
});
