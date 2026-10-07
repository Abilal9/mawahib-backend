import type {
  Invoice,
  InvoiceProviderKind,
  PaymentStatus,
  WorkEngagement,
} from '@prisma/client';

export type InvoiceWithParties = Invoice & {
  engagement: Pick<WorkEngagement, 'id' | 'clientId' | 'providerId'>;
};

/** Everything needed to render an invoice for a succeeded payment. */
export interface PaymentInvoiceContext {
  paymentId: string;
  status: PaymentStatus;
  engagementId: string;
  engagementTitle: string;
  payerUserId: string;
  payerName: string;
  payeeName: string;
  amount: string;
  currency: string;
  providerReference: string | null;
}

export interface InvoiceRepository {
  loadPaymentContext(paymentId: string): Promise<PaymentInvoiceContext | null>;
  findByPaymentId(paymentId: string): Promise<Invoice | null>;
  /** Throws a Prisma P2002 error on duplicate paymentId / invoiceNumber. */
  createPending(input: {
    id: string;
    engagementId: string;
    paymentId: string;
    invoiceNumber: string;
    provider: InvoiceProviderKind;
    currency: string;
    subtotal: string;
    taxAmount: string;
    total: string;
  }): Promise<Invoice>;
  markPending(id: string): Promise<Invoice>;
  markGenerated(
    id: string,
    input: {
      providerReference: string;
      documentMediaAssetId: string;
      originalFileName: string;
      issuedAt: Date;
    },
  ): Promise<Invoice>;
  markFailed(id: string, failureMessage: string): Promise<Invoice>;
  findById(id: string): Promise<InvoiceWithParties | null>;
  listForEngagement(engagementId: string): Promise<Invoice[]>;
  findEngagementParties(
    engagementId: string,
  ): Promise<Pick<WorkEngagement, 'id' | 'clientId' | 'providerId'> | null>;
}

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');
