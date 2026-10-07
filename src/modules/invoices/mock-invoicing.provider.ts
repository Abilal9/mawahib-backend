import { Injectable } from '@nestjs/common';
import { InvoiceProviderKind } from '@prisma/client';
import type {
  GeneratedInvoiceDocument,
  InvoiceDocumentInput,
  InvoicingProvider,
} from './invoicing-provider.interface';
import { renderMockInvoicePdf } from './mock-invoice-pdf';

/**
 * DEVELOPMENT ONLY. Renders a watermarked PDF that is explicitly NOT a fiscal
 * document (no ZATCA / tax authority involvement).
 */
@Injectable()
export class MockInvoicingProvider implements InvoicingProvider {
  readonly kind = InvoiceProviderKind.mock;

  generateInvoice(
    input: InvoiceDocumentInput,
  ): Promise<GeneratedInvoiceDocument> {
    return Promise.resolve({
      providerReference: `mock_inv_${input.invoiceNumber}`,
      pdf: renderMockInvoicePdf(input),
      mimeType: 'application/pdf',
    });
  }
}
