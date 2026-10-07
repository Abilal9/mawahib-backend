import type {
  Invoice,
  Payment,
  PaymentMethod,
  PaymentProviderKind,
} from '@prisma/client';

export type PaymentWithInvoice = Payment & {
  invoice: Pick<Invoice, 'id' | 'invoiceNumber' | 'status'> | null;
};

export interface CreatePaymentInput {
  id: string;
  engagementId: string;
  payerUserId: string;
  payeeUserId: string;
  /** Decimal string — taken from the engagement chargeable total. */
  amount: string;
  currency: string;
  method: PaymentMethod;
  provider: PaymentProviderKind;
  idempotencyKey: string;
  mockMethodToken: string;
}

export interface PaymentRepository {
  create(input: CreatePaymentInput): Promise<PaymentWithInvoice>;
  findById(id: string): Promise<PaymentWithInvoice | null>;
  findByIdempotencyKey(key: string): Promise<PaymentWithInvoice | null>;
  findSucceededForEngagement(
    engagementId: string,
  ): Promise<PaymentWithInvoice | null>;
  /** Succeeded payment if any, otherwise the most recent attempt. */
  findLatestForEngagement(
    engagementId: string,
  ): Promise<PaymentWithInvoice | null>;
  markProcessing(
    id: string,
    providerReference: string,
  ): Promise<PaymentWithInvoice>;
  /**
   * Sets status SUCCEEDED and `settlementKey = engagementId`. Throws
   * ConflictException when the engagement already has a settled payment.
   */
  markSucceeded(input: {
    id: string;
    engagementId: string;
    providerReference: string;
  }): Promise<PaymentWithInvoice>;
  markFailed(
    id: string,
    failure: {
      providerReference?: string | null;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<PaymentWithInvoice>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
