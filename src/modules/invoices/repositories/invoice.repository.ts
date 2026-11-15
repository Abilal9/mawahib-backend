import type {
  Invoice,
  InvoiceProviderKind,
  PaymentStatus,
  WorkEngagement,
} from '@prisma/client';

export type InvoiceWithParties = Invoice & {
  engagement: Pick<WorkEngagement, 'id' | 'clientId' | 'providerId'>;
};

/** Live fields read once, only while creating the invoice row. */
export interface InvoiceCreateContext {
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

export type InvoiceClaim =
  | { kind: 'claimed'; invoice: Invoice; payerUserId: string }
  | { kind: 'generated'; invoice: Invoice }
  | { kind: 'in_progress' }
  | { kind: 'snapshot_unavailable' }
  | { kind: 'payment_not_succeeded' }
  | { kind: 'not_found' };

export interface InvoiceRepository {
  /** Joins the payer and payee profiles. Used only for the creating insert. */
  loadCreateContext(paymentId: string): Promise<InvoiceCreateContext | null>;
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
    payerDisplayName: string;
    payeeDisplayName: string;
    description: string;
    paymentReference: string;
  }): Promise<Invoice>;
  /**
   * One transaction: optional active-staff check, conditional claim, and the
   * audit row. A lost claim writes nothing.
   */
  claimGeneration(input: {
    invoiceId: string;
    token: string;
    staleBefore: Date;
    staff: { issuer: string; subjectId: string } | null;
  }): Promise<InvoiceClaim>;
  /** Returns the invoice only when this token still owns a pending or failed row. */
  completeGeneration(
    id: string,
    token: string,
    input: {
      providerReference: string;
      documentMediaAssetId: string;
      originalFileName: string;
      issuedAt: Date;
    },
  ): Promise<Invoice | null>;
  /** Returns false when this token no longer owns the row. */
  failGeneration(id: string, token: string, failureMessage: string): Promise<boolean>;
  findById(id: string): Promise<InvoiceWithParties | null>;
  listForEngagement(engagementId: string): Promise<Invoice[]>;
  findEngagementParties(
    engagementId: string,
  ): Promise<Pick<WorkEngagement, 'id' | 'clientId' | 'providerId'> | null>;
}

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');
