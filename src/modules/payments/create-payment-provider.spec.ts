import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PaymentProviderKind } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import { createPaymentProvider } from './create-payment-provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';

describe('createPaymentProvider', () => {
  it('binds the mock implementation when mock is selected', async () => {
    const config = {
      get: (key: keyof Env) => (key === 'PAYMENT_PROVIDER' ? 'mock' : undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config },
        {
          provide: PAYMENT_PROVIDER,
          useFactory: (injected: ConfigService<Env, true>) =>
            createPaymentProvider(
              injected.get('PAYMENT_PROVIDER', { infer: true }),
            ),
          inject: [ConfigService],
        },
      ],
    }).compile();

    const provider = moduleRef.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    expect(provider).toBeInstanceOf(MockPaymentProvider);
    expect(provider.kind).toBe(PaymentProviderKind.mock);
  });
});
