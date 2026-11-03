import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { InvoiceProviderKind } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import { createInvoicingProvider } from './create-invoicing-provider';
import { INVOICING_PROVIDER } from './invoicing-provider.interface';
import { MockInvoicingProvider } from './mock-invoicing.provider';

describe('createInvoicingProvider', () => {
  it('binds the mock implementation when mock is selected', async () => {
    const config = {
      get: (key: keyof Env) => (key === 'INVOICE_PROVIDER' ? 'mock' : undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config },
        {
          provide: INVOICING_PROVIDER,
          useFactory: (injected: ConfigService<Env, true>) =>
            createInvoicingProvider(
              injected.get('INVOICE_PROVIDER', { infer: true }),
            ),
          inject: [ConfigService],
        },
      ],
    }).compile();

    const provider = moduleRef.get<MockInvoicingProvider>(INVOICING_PROVIDER);
    expect(provider).toBeInstanceOf(MockInvoicingProvider);
    expect(provider.kind).toBe(InvoiceProviderKind.mock);
  });
});
