import type { PaymentMethod, PaymentProviderKind } from '@prisma/client';

/** What the provider reports back; `requires_confirmation` precedes confirm. */
export type ProviderPaymentStatus =
  'requires_confirmation' | 'succeeded' | 'failed';

export interface ProviderPaymentResult {
  /** Provider-side reference, persisted as `Payment.providerReference`. */
  providerReference: string;
  status: ProviderPaymentStatus;
  failureCode?: string;
  failureMessage?: string;
}

export interface CreateProviderPaymentInput {
  /** Decimal string, e.g. "1250.00" — always derived server-side. */
  amount: string;
  currency: string;
  method: PaymentMethod;
  /**
   * Opaque tokenised payment method. Never a PAN / CVV — raw card data must
   * not reach this backend.
   */
  methodToken: string;
  idempotencyKey: string;
  metadata: { paymentId: string; engagementId: string };
}

export interface ConfirmProviderPaymentInput {
  providerReference: string;
  method: PaymentMethod;
  methodToken: string;
}

export interface PaymentProvider {
  readonly kind: PaymentProviderKind;
  /** Throws BadRequest when the method / token pair is not acceptable. */
  validateMethod(method: PaymentMethod, methodToken: string): void;
  createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<ProviderPaymentResult>;
  confirmPayment(
    input: ConfirmProviderPaymentInput,
  ): Promise<ProviderPaymentResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
