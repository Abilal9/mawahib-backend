import { ConflictException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  CreatePaymentInput,
  PaymentRepository,
  PaymentWithInvoice,
} from './payment.repository';

const include = {
  invoice: { select: { id: true, invoiceNumber: true, status: true } },
} as const;

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreatePaymentInput): Promise<PaymentWithInvoice> {
    return this.prisma.payment.create({
      data: {
        id: input.id,
        engagementId: input.engagementId,
        payerUserId: input.payerUserId,
        payeeUserId: input.payeeUserId,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        mockMethodToken: input.mockMethodToken,
        status: PaymentStatus.pending,
      },
      include,
    });
  }

  findById(id: string): Promise<PaymentWithInvoice | null> {
    return this.prisma.payment.findUnique({ where: { id }, include });
  }

  findByIdempotencyKey(key: string): Promise<PaymentWithInvoice | null> {
    return this.prisma.payment.findUnique({
      where: { idempotencyKey: key },
      include,
    });
  }

  findSucceededForEngagement(
    engagementId: string,
  ): Promise<PaymentWithInvoice | null> {
    return this.prisma.payment.findFirst({
      where: { engagementId, status: PaymentStatus.succeeded },
      include,
    });
  }

  async findLatestForEngagement(
    engagementId: string,
  ): Promise<PaymentWithInvoice | null> {
    const succeeded = await this.findSucceededForEngagement(engagementId);
    if (succeeded) return succeeded;
    return this.prisma.payment.findFirst({
      where: { engagementId },
      orderBy: { createdAt: 'desc' },
      include,
    });
  }

  markProcessing(
    id: string,
    providerReference: string,
  ): Promise<PaymentWithInvoice> {
    return this.prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.processing, providerReference },
      include,
    });
  }

  async markSucceeded(input: {
    id: string;
    engagementId: string;
    providerReference: string;
  }): Promise<PaymentWithInvoice> {
    try {
      return await this.prisma.payment.update({
        where: { id: input.id },
        data: {
          status: PaymentStatus.succeeded,
          providerReference: input.providerReference,
          succeededAt: new Date(),
          failureCode: null,
          failureMessage: null,
          // Unique: at most one successful settlement per engagement.
          settlementKey: input.engagementId,
        },
        include,
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This engagement already has a successful payment',
        );
      }
      throw err;
    }
  }

  markFailed(
    id: string,
    failure: {
      providerReference?: string | null;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<PaymentWithInvoice> {
    return this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.failed,
        failedAt: new Date(),
        failureCode: failure.failureCode,
        failureMessage: failure.failureMessage,
        ...(failure.providerReference
          ? { providerReference: failure.providerReference }
          : {}),
      },
      include,
    });
  }
}
