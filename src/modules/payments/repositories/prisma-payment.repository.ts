import { ConflictException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, WorkEngagementStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  deadlineFromAgreedTerms,
  scheduleCreateData,
  scheduleFromDuration,
} from '../../marketplace/engagement-schedule';
import { businessTodayIso } from '../../marketplace/work-request-terms';
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
    return this.prisma.$transaction(async (tx) => {
      const engagement = await lockEngagement(tx, input.engagementId);
      if (!engagement || engagement.status !== WorkEngagementStatus.pending_payment) {
        throw new ConflictException('Payment is not accepted for this job');
      }
      const attempts = await lockPayments(tx, input.engagementId);
      if (attempts.some((row) => row.status === PaymentStatus.processing || row.status === PaymentStatus.succeeded)) {
        throw new ConflictException('This job has already been paid or a payment is in progress');
      }
      const created = await tx.payment.create({
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
      const claimed = await tx.payment.updateMany({
        where: { id: created.id, status: PaymentStatus.pending },
        data: { status: PaymentStatus.processing },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Payment could not be started');
      }
      return tx.payment.findUniqueOrThrow({ where: { id: created.id }, include });
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

  async markProcessing(
    id: string,
    providerReference: string,
  ): Promise<PaymentWithInvoice> {
    const updated = await this.prisma.payment.updateMany({
      where: { id, status: PaymentStatus.processing },
      data: { providerReference },
    });
    const current = await this.prisma.payment.findUnique({ where: { id }, include });
    if (!current) throw new ConflictException('Payment not found');
    if (updated.count !== 1) {
      throw new ConflictException('This payment is no longer in progress');
    }
    return current;
  }

  async markSucceeded(input: {
    id: string;
    engagementId: string;
    providerReference: string;
    actorId: string;
  }): Promise<PaymentWithInvoice> {
    try {
      const settled = await this.prisma.$transaction(async (tx) => {
        const engagement = await lockEngagement(tx, input.engagementId);
        const attempts = await lockPayments(tx, input.engagementId);
        const current = attempts.find((row) => row.id === input.id);
        if (!current) throw new ConflictException('Payment not found');
        if (current.status === PaymentStatus.succeeded) {
          return tx.payment.findUniqueOrThrow({ where: { id: input.id }, include });
        }
        const otherSucceeded = attempts.some(
          (row) => row.id !== input.id && row.status === PaymentStatus.succeeded,
        );
        const payable = engagement?.status === WorkEngagementStatus.pending_payment;
        if (current.status !== PaymentStatus.processing || !payable || otherSucceeded) {
          await tx.payment.updateMany({
            where: { id: input.id, status: PaymentStatus.processing },
            data: {
              status: PaymentStatus.failed,
              failedAt: new Date(),
              providerReference: input.providerReference,
              failureCode: !payable ? 'engagement_not_payable' : 'duplicate_settlement',
              failureMessage: !payable
                ? 'This job is no longer awaiting payment.'
                : 'This job has already been paid.',
            },
          });
          return null;
        }
        const won = await tx.payment.updateMany({
          where: { id: input.id, status: PaymentStatus.processing },
          data: {
            status: PaymentStatus.succeeded,
            providerReference: input.providerReference,
            succeededAt: new Date(),
            failureCode: null,
            failureMessage: null,
            settlementKey: input.engagementId,
          },
        });
        if (won.count !== 1) {
          throw new ConflictException('This payment was already finished');
        }
        const started = await tx.workEngagement.updateMany({
          where: {
            id: input.engagementId,
            status: WorkEngagementStatus.pending_payment,
            deletedAt: null,
          },
          data: { status: WorkEngagementStatus.in_progress },
        });
        if (started.count !== 1) {
          throw new ConflictException('Engagement was updated by another request — refresh and try again');
        }
        const startedAt = new Date();
        await tx.engagementEvent.create({
          data: {
            engagementId: input.engagementId,
            fromStatus: WorkEngagementStatus.pending_payment,
            toStatus: WorkEngagementStatus.in_progress,
            actorId: input.actorId,
            note: 'Payment received — work started',
            createdAt: startedAt,
          },
        });
        await insertDurationSchedule(tx, input.engagementId, startedAt);
        return tx.payment.findUniqueOrThrow({ where: { id: input.id }, include });
      });
      if (!settled) {
        throw new ConflictException('This job is no longer awaiting payment');
      }
      return settled;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('This engagement already has a successful payment');
      }
      throw err;
    }
  }

  async markFailed(
    id: string,
    failure: {
      providerReference?: string | null;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<PaymentWithInvoice> {
    await this.prisma.payment.updateMany({
      where: { id, status: { in: [PaymentStatus.pending, PaymentStatus.processing] } },
      data: {
        status: PaymentStatus.failed,
        failedAt: new Date(),
        failureCode: failure.failureCode,
        failureMessage: failure.failureMessage,
        ...(failure.providerReference
          ? { providerReference: failure.providerReference }
          : {}),
      },
    });
    const current = await this.prisma.payment.findUnique({ where: { id }, include });
    if (!current) throw new ConflictException('Payment not found');
    return current;
  }
}

async function lockEngagement(
  tx: Prisma.TransactionClient,
  engagementId: string,
): Promise<{ status: string } | null> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status
    FROM work_engagements
    WHERE id = ${engagementId}::uuid
      AND deleted_at IS NULL
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockPayments(
  tx: Prisma.TransactionClient,
  engagementId: string,
): Promise<Array<{ id: string; status: string }>> {
  return tx.$queryRaw`
    SELECT id::text AS id, status::text AS status
    FROM payments
    WHERE engagement_id = ${engagementId}::uuid
    FOR UPDATE
  `;
}

async function insertDurationSchedule(
  tx: Prisma.TransactionClient,
  engagementId: string,
  startedAt: Date,
): Promise<void> {
  const existing = await tx.engagementSchedule.findUnique({
    where: { engagementId },
    select: { engagementId: true },
  });
  if (existing) return;
  const request = await tx.workRequest.findFirst({
    where: { workEngagementId: engagementId },
    select: { agreedTermsJson: true },
  });
  const deadline = deadlineFromAgreedTerms(request?.agreedTermsJson);
  if (!deadline || deadline.type !== 'duration') return;
  const draft = scheduleFromDuration(deadline, businessTodayIso(startedAt));
  if (!draft) return;
  await tx.engagementSchedule.create({
    data: { engagementId, ...scheduleCreateData(draft) },
  });
}
