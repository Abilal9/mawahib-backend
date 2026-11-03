import type { Env } from '../../config/env.schema';
import type { InvoicingProvider } from './invoicing-provider.interface';
import { MockInvoicingProvider } from './mock-invoicing.provider';

/** The only implemented invoice provider. A missing kind must not become real. */
export function createInvoicingProvider(
  kind: Env['INVOICE_PROVIDER'],
): InvoicingProvider {
  switch (kind) {
    case 'mock':
      return new MockInvoicingProvider();
    default: {
      const unsupported: never = kind;
      throw new Error(
        `Unsupported INVOICE_PROVIDER: ${String(unsupported)}`,
      );
    }
  }
}
