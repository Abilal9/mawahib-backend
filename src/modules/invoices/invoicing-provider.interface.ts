import type { InvoiceProviderKind } from '@prisma/client';

export interface InvoiceDocumentInput {
  invoiceNumber: string;
  issuedAt: Date;
  currency: string;
  /** Decimal strings, e.g. "1250.00". */
  subtotal: string;
  taxAmount: string;
  total: string;
  /** What was paid for (the engagement title). */
  description: string;
  payerName: string;
  payeeName: string;
  paymentReference: string | null;
}

export interface GeneratedInvoiceDocument {
  providerReference: string;
  pdf: Buffer;
  mimeType: 'application/pdf';
}

export interface InvoicingProvider {
  readonly kind: InvoiceProviderKind;
  generateInvoice(
    input: InvoiceDocumentInput,
  ): Promise<GeneratedInvoiceDocument>;
}

export const INVOICING_PROVIDER = Symbol('INVOICING_PROVIDER');
