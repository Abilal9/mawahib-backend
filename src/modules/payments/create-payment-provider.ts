import type { Env } from '../../config/env.schema';
import { MockPaymentProvider } from './mock-payment.provider';
import type { PaymentProvider } from './payment-provider.interface';

/** The only implemented payment provider. A missing kind must not become real. */
export function createPaymentProvider(
  kind: Env['PAYMENT_PROVIDER'],
): PaymentProvider {
  switch (kind) {
    case 'mock':
      return new MockPaymentProvider();
    default: {
      const unsupported: never = kind;
      throw new Error(
        `Unsupported PAYMENT_PROVIDER: ${String(unsupported)}`,
      );
    }
  }
}
