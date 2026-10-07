import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, WorkEngagementStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { InvoicesService } from '../invoices/invoices.service';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { CreatePaymentDto } from './dto/payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.interface';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type PaymentWithInvoice,
} from './repositories/payment.repository';

/** How long a same-key replay waits for the owner of the attempt to finish. */
const IN_FLIGHT_POLLS = 8;
const IN_FLIGHT_POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
    private readonly marketplace: MarketplaceService,
    private readonly invoices: InvoicesService,
  ) {}

  /**
   * Pays an engagement. The charge is ALWAYS the engagement's chargeable total
   * (package + add-ons); the client cannot influence amount or currency.
   *
   * - Same `idempotencyKey` → the original payment is returned, never re-run.
   * - Success → engagement pending_payment → in_progress, then an invoice is
   *   generated fire-and-forget (its failure never rolls back the payment).
   * - Decline → payment `failed`; the engagement stays pending_payment so the
   *   client can retry with a fresh key.
   */
  async createPayment(
    userId: string,
    dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    const existing = await this.payments.findByIdempotencyKey(
      dto.idempotencyKey,
    );
    if (existing) return this.replay(userId, dto, existing);

    // Party check (404 / 403) lives in the marketplace read.
    const engagement = await this.marketplace.getEngagement(
      userId,
      dto.engagementId,
    );
    if (engagement.clientId !== userId) {
      throw new ForbiddenException('Only the client can pay for this job');
    }
    const settled = await this.payments.findSucceededForEngagement(
      engagement.id,
    );
    if (settled) {
      throw new ConflictException('This job has already been paid');
    }
    if (engagement.status !== WorkEngagementStatus.pending_payment) {
      throw new ConflictException(
        `Payment is not accepted while the job is ${engagement.status}`,
      );
    }
    if (!engagement.detail) {
      throw new BadRequestException('Engagement has no chargeable terms');
    }
    const amount = engagement.detail.chargeableTotal;
    if (!(Number(amount) > 0)) {
      throw new BadRequestException('Engagement amount must be greater than 0');
    }
    const currency = engagement.detail.currency;

    this.provider.validateMethod(dto.method, dto.mockMethodToken);

    let payment: PaymentWithInvoice;
    try {
      payment = await this.payments.create({
        id: randomUUID(),
        engagementId: engagement.id,
        payerUserId: userId,
        payeeUserId: engagement.providerId,
        amount,
        currency,
        method: dto.method,
        provider: this.provider.kind,
        idempotencyKey: dto.idempotencyKey,
        mockMethodToken: dto.mockMethodToken,
      });
    } catch (err: unknown) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race on the same key — behave like a replay.
      const raced = await this.payments.findByIdempotencyKey(
        dto.idempotencyKey,
      );
      if (raced) return this.replay(userId, dto, raced);
      throw err;
    }

    return this.process(payment, dto, amount, currency);
  }

  async getPayment(userId: string, id: string): Promise<PaymentResponseDto> {
    const payment = await this.payments.findById(id);
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.payerUserId !== userId && payment.payeeUserId !== userId) {
      throw new ForbiddenException('You are not a party to this payment');
    }
    return PaymentResponseDto.fromEntity(payment);
  }

  /** Succeeded payment if present, otherwise the latest attempt. */
  async getPaymentForEngagement(
    userId: string,
    engagementId: string,
  ): Promise<PaymentResponseDto> {
    await this.marketplace.getEngagement(userId, engagementId);
    const payment = await this.payments.findLatestForEngagement(engagementId);
    if (!payment) throw new NotFoundException('No payment for this job yet');
    return PaymentResponseDto.fromEntity(payment);
  }

  private async process(
    payment: PaymentWithInvoice,
    dto: CreatePaymentDto,
    amount: string,
    currency: string,
  ): Promise<PaymentResponseDto> {
    let providerReference: string | null = null;
    let outcome;
    try {
      const created = await this.provider.createPayment({
        amount,
        currency,
        method: dto.method,
        methodToken: dto.mockMethodToken,
        idempotencyKey: dto.idempotencyKey,
        metadata: { paymentId: payment.id, engagementId: payment.engagementId },
      });
      providerReference = created.providerReference;
      await this.payments.markProcessing(payment.id, providerReference);
      outcome = await this.provider.confirmPayment({
        providerReference,
        method: dto.method,
        methodToken: dto.mockMethodToken,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Payment ${payment.id} provider error: ${message}`);
      const failed = await this.payments.markFailed(payment.id, {
        providerReference,
        failureCode: 'provider_error',
        failureMessage: 'The payment could not be processed.',
      });
      return PaymentResponseDto.fromEntity(failed);
    }

    if (outcome.status !== 'succeeded') {
      const failed = await this.payments.markFailed(payment.id, {
        providerReference: outcome.providerReference,
        failureCode: outcome.failureCode ?? 'payment_failed',
        failureMessage: outcome.failureMessage ?? 'The payment failed.',
      });
      return PaymentResponseDto.fromEntity(failed);
    }

    let succeeded: PaymentWithInvoice;
    try {
      succeeded = await this.payments.markSucceeded({
        id: payment.id,
        engagementId: payment.engagementId,
        providerReference: outcome.providerReference,
      });
    } catch (err: unknown) {
      if (err instanceof ConflictException) {
        // Another payment settled this engagement first; this attempt loses.
        await this.payments.markFailed(payment.id, {
          providerReference: outcome.providerReference,
          failureCode: 'duplicate_settlement',
          failureMessage: 'This job has already been paid.',
        });
      }
      throw err;
    }

    await this.settleEngagement(succeeded);
    this.triggerInvoice(succeeded.id);
    return PaymentResponseDto.fromEntity(succeeded);
  }

  /**
   * Replays an earlier request. A succeeded payment also re-attempts the
   * engagement settlement / invoice if a previous run stopped half-way, so a
   * client retry with the same key heals the state.
   */
  private async replay(
    userId: string,
    dto: CreatePaymentDto,
    existing: PaymentWithInvoice,
  ): Promise<PaymentResponseDto> {
    if (
      existing.payerUserId !== userId ||
      existing.engagementId !== dto.engagementId
    ) {
      throw new ConflictException(
        'This idempotency key was already used for a different payment',
      );
    }
    const current = await this.awaitInFlight(existing);
    if (current.status === PaymentStatus.succeeded) {
      const engagement = await this.marketplace.getEngagement(
        userId,
        existing.engagementId,
      );
      if (engagement.status === WorkEngagementStatus.pending_payment) {
        await this.settleEngagement(existing);
      }
      if (current.invoice?.status !== 'generated') {
        this.triggerInvoice(current.id);
      }
    }
    // pending / processing here is intentional: this caller did not start the
    // provider. The client keeps the same idempotency key and refetches.
    return PaymentResponseDto.fromEntity(current);
  }

  /**
   * Re-reads an in-flight attempt until it is succeeded or failed, or the
   * short budget ends. Never calls the provider.
   */
  private async awaitInFlight(
    payment: PaymentWithInvoice,
  ): Promise<PaymentWithInvoice> {
    if (
      payment.status !== PaymentStatus.pending &&
      payment.status !== PaymentStatus.processing
    ) {
      return payment;
    }
    let current = payment;
    for (let i = 0; i < IN_FLIGHT_POLLS; i++) {
      await sleep(IN_FLIGHT_POLL_MS);
      const next = await this.payments.findById(current.id);
      if (!next) return current;
      current = next;
      if (
        current.status !== PaymentStatus.pending &&
        current.status !== PaymentStatus.processing
      ) {
        return current;
      }
    }
    return current;
  }

  private async settleEngagement(payment: PaymentWithInvoice): Promise<void> {
    try {
      await this.marketplace.settleEngagementAfterSuccessfulPayment(
        payment.engagementId,
        payment.payerUserId,
      );
    } catch (err: unknown) {
      // The payment is already recorded as succeeded; retrying with the same
      // idempotency key re-runs settlement.
      this.logger.error(
        `Payment ${payment.id} succeeded but engagement ${payment.engagementId} could not start: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  /** Fire-and-forget: an invoice problem must never undo or fail a payment. */
  private triggerInvoice(paymentId: string): void {
    void Promise.resolve()
      .then(() => this.invoices.generateForPayment(paymentId))
      .catch((err: unknown) => {
        this.logger.error(
          `Invoice for payment ${paymentId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}
