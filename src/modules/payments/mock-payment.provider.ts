import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentProviderKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {
  ConfirmProviderPaymentInput,
  CreateProviderPaymentInput,
  PaymentProvider,
  ProviderPaymentResult,
} from './payment-provider.interface';

interface MockOutcome {
  method: PaymentMethod;
  succeeds: boolean;
  failureCode?: string;
  failureMessage?: string;
}

/** Deterministic dev tokens — the only "cards" the mock provider knows. */
export const MOCK_PAYMENT_TOKENS: Readonly<Record<string, MockOutcome>> = {
  mock_visa_success: { method: PaymentMethod.card, succeeds: true },
  mock_mastercard_success: { method: PaymentMethod.card, succeeds: true },
  mock_card_declined: {
    method: PaymentMethod.card,
    succeeds: false,
    failureCode: 'card_declined',
    failureMessage: 'Your card was declined.',
  },
  mock_apple_pay_success: { method: PaymentMethod.apple_pay, succeeds: true },
  mock_apple_pay_declined: {
    method: PaymentMethod.apple_pay,
    succeeds: false,
    failureCode: 'apple_pay_declined',
    failureMessage: 'Apple Pay payment was declined.',
  },
};

/**
 * DEVELOPMENT ONLY. Settles purely from the token name; no money moves.
 * `validateEnv` refuses to boot in production with PAYMENT_PROVIDER=mock.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly kind = PaymentProviderKind.mock;

  validateMethod(method: PaymentMethod, methodToken: string): void {
    const outcome = MOCK_PAYMENT_TOKENS[methodToken];
    if (!outcome) {
      throw new BadRequestException(
        `Unknown mock payment token. Use one of: ${Object.keys(MOCK_PAYMENT_TOKENS).join(', ')}`,
      );
    }
    if (outcome.method !== method) {
      throw new BadRequestException(
        `Token ${methodToken} cannot be used with payment method ${method}`,
      );
    }
  }

  createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    this.validateMethod(input.method, input.methodToken);
    return Promise.resolve({
      providerReference: `mock_pay_${randomUUID().replace(/-/g, '')}`,
      status: 'requires_confirmation',
    });
  }

  confirmPayment(
    input: ConfirmProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    this.validateMethod(input.method, input.methodToken);
    const outcome = MOCK_PAYMENT_TOKENS[input.methodToken];
    if (outcome.succeeds) {
      return Promise.resolve({
        providerReference: input.providerReference,
        status: 'succeeded',
      });
    }
    return Promise.resolve({
      providerReference: input.providerReference,
      status: 'failed',
      failureCode: outcome.failureCode,
      failureMessage: outcome.failureMessage,
    });
  }
}
