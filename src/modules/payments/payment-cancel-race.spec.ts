import { ConflictException } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentProviderKind,
  PaymentStatus,
  PrismaClient,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import { PrismaMarketplaceRepository } from '../marketplace/repositories/prisma-marketplace.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payment.repository';

const databaseUrl = process.env.PAYMENT_RACE_DATABASE_URL;
const describeRace = databaseUrl ? describe : describe.skip;

describeRace('payment and cancellation race', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const payments = new PrismaPaymentRepository(prisma as never);
  const marketplace = new PrismaMarketplaceRepository(prisma as never);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(status: WorkEngagementStatus = WorkEngagementStatus.pending_payment) {
    const id = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const engagementId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: clientId,
        email: `${clientId}@race.test`,
        accountType: 'business',
        displayName: 'Client',
        username: `c${clientId.slice(0, 12)}`,
      },
    });
    await prisma.user.create({
      data: {
        id: providerId,
        email: `${providerId}@race.test`,
        accountType: 'talent',
        displayName: 'Provider',
        username: `p${providerId.slice(0, 12)}`,
      },
    });
    await prisma.workEngagement.create({
      data: {
        id: engagementId,
        clientId,
        providerId,
        title: 'Race',
        status,
        source: WorkEngagementSource.direct,
      },
    });
    await prisma.workRequest.create({
      data: {
        id: requestId,
        source: WorkRequestSource.direct_request,
        senderUserId: providerId,
        recipientUserId: clientId,
        clientUserId: clientId,
        providerUserId: providerId,
        workEngagementId: engagementId,
        title: 'Race',
        status: WorkRequestStatus.pending_payment,
        termsJson: {},
      },
    });
    return { id, clientId, providerId, engagementId, requestId };
  }

  async function attempt(engagementId: string, payerId: string, payeeId: string, status: PaymentStatus, reference: string | null = null) {
    return prisma.payment.create({
      data: {
        engagementId,
        payerUserId: payerId,
        payeeUserId: payeeId,
        amount: '10.00',
        currency: 'AED',
        method: PaymentMethod.card,
        provider: PaymentProviderKind.mock,
        status,
        providerReference: reference,
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }

  it('does not start a payment after cancellation commits', async () => {
    const row = await seed();
    await marketplace.withdrawPendingPaymentTransactional({
      workRequestId: row.requestId,
      engagementId: row.engagementId,
      actorId: row.providerId,
    });
    await expect(payments.create({
      id: crypto.randomUUID(),
      engagementId: row.engagementId,
      payerUserId: row.clientId,
      payeeUserId: row.providerId,
      amount: '10.00',
      currency: 'AED',
      method: PaymentMethod.card,
      provider: PaymentProviderKind.mock,
      idempotencyKey: crypto.randomUUID(),
      mockMethodToken: 'mock_visa_success',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.payment.count({ where: { engagementId: row.engagementId } })).toBe(0);
  });

  it('refuses cancellation when a payment is processing or has succeeded', async () => {
    const processing = await seed();
    await attempt(processing.engagementId, processing.clientId, processing.providerId, PaymentStatus.processing);
    await expect(marketplace.withdrawPendingPaymentTransactional({
      workRequestId: processing.requestId,
      engagementId: processing.engagementId,
      actorId: processing.providerId,
    })).rejects.toBeInstanceOf(ConflictException);

    const succeeded = await seed();
    await attempt(succeeded.engagementId, succeeded.clientId, succeeded.providerId, PaymentStatus.succeeded, 'mock_ref');
    await prisma.payment.updateMany({
      where: { engagementId: succeeded.engagementId },
      data: { settlementKey: succeeded.engagementId },
    });
    await attempt(succeeded.engagementId, succeeded.clientId, succeeded.providerId, PaymentStatus.failed, 'mock_old');
    await expect(marketplace.withdrawPendingPaymentTransactional({
      workRequestId: succeeded.requestId,
      engagementId: succeeded.engagementId,
      actorId: succeeded.providerId,
    })).rejects.toBeInstanceOf(ConflictException);
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: succeeded.engagementId } });
    expect(engagement.status).toBe(WorkEngagementStatus.pending_payment);
  });

  it('cancels an unstarted mock attempt and the engagement together', async () => {
    const row = await seed();
    const pending = await attempt(row.engagementId, row.clientId, row.providerId, PaymentStatus.pending);
    await marketplace.withdrawPendingPaymentTransactional({
      workRequestId: row.requestId,
      engagementId: row.engagementId,
      actorId: row.providerId,
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(payment.status).toBe(PaymentStatus.cancelled);
    expect(payment.failureCode).toBe('cancelled_before_start');
    expect(engagement.status).toBe(WorkEngagementStatus.cancelled);
  });

  it('does not succeed a claimed payment after cancellation wins the lock', async () => {
    const row = await seed();
    const claimed = await payments.create({
      id: crypto.randomUUID(),
      engagementId: row.engagementId,
      payerUserId: row.clientId,
      payeeUserId: row.providerId,
      amount: '10.00',
      currency: 'AED',
      method: PaymentMethod.card,
      provider: PaymentProviderKind.mock,
      idempotencyKey: crypto.randomUUID(),
      mockMethodToken: 'mock_visa_success',
    });
    expect(claimed.status).toBe(PaymentStatus.processing);
    await prisma.payment.update({
      where: { id: claimed.id },
      data: { status: PaymentStatus.pending, providerReference: null },
    });
    await marketplace.withdrawPendingPaymentTransactional({
      workRequestId: row.requestId,
      engagementId: row.engagementId,
      actorId: row.providerId,
    });
    await expect(payments.markSucceeded({
      id: claimed.id,
      engagementId: row.engagementId,
      providerReference: 'mock_late',
      actorId: row.clientId,
    })).rejects.toBeInstanceOf(ConflictException);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: claimed.id } });
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(payment.status).not.toBe(PaymentStatus.succeeded);
    expect(engagement.status).toBe(WorkEngagementStatus.cancelled);
  });

  it('starts work and then refuses cancellation, including a repeated settlement', async () => {
    const row = await seed();
    const claimed = await payments.create({
      id: crypto.randomUUID(),
      engagementId: row.engagementId,
      payerUserId: row.clientId,
      payeeUserId: row.providerId,
      amount: '10.00',
      currency: 'AED',
      method: PaymentMethod.card,
      provider: PaymentProviderKind.mock,
      idempotencyKey: crypto.randomUUID(),
      mockMethodToken: 'mock_visa_success',
    });
    const settled = await payments.markSucceeded({
      id: claimed.id,
      engagementId: row.engagementId,
      providerReference: 'mock_ok',
      actorId: row.clientId,
    });
    const again = await payments.markSucceeded({
      id: claimed.id,
      engagementId: row.engagementId,
      providerReference: 'mock_ok',
      actorId: row.clientId,
    });
    expect(settled.status).toBe(PaymentStatus.succeeded);
    expect(again.status).toBe(PaymentStatus.succeeded);
    expect(await prisma.engagementEvent.count({ where: { engagementId: row.engagementId, toStatus: 'in_progress' } })).toBe(1);
    await expect(marketplace.withdrawPendingPaymentTransactional({
      workRequestId: row.requestId,
      engagementId: row.engagementId,
      actorId: row.providerId,
    })).rejects.toBeInstanceOf(ConflictException);
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe(WorkEngagementStatus.in_progress);
  });

  it('rolls the cancellation back when the work request cannot change', async () => {
    const row = await seed();
    const pending = await attempt(row.engagementId, row.clientId, row.providerId, PaymentStatus.pending);
    await expect(marketplace.withdrawPendingPaymentTransactional({
      workRequestId: crypto.randomUUID(),
      engagementId: row.engagementId,
      actorId: row.providerId,
    })).rejects.toBeInstanceOf(ConflictException);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(payment.status).toBe(PaymentStatus.pending);
    expect(engagement.status).toBe(WorkEngagementStatus.pending_payment);
  });

  it('serializes a concurrent settlement and cancellation so a cancelled job is not paid', async () => {
    const row = await seed();
    const claimed = await payments.create({
      id: crypto.randomUUID(),
      engagementId: row.engagementId,
      payerUserId: row.clientId,
      payeeUserId: row.providerId,
      amount: '10.00',
      currency: 'AED',
      method: PaymentMethod.card,
      provider: PaymentProviderKind.mock,
      idempotencyKey: crypto.randomUUID(),
      mockMethodToken: 'mock_visa_success',
    });
    const results = await Promise.allSettled([
      payments.markSucceeded({
        id: claimed.id,
        engagementId: row.engagementId,
        providerReference: 'mock_race',
        actorId: row.clientId,
      }),
      marketplace.withdrawPendingPaymentTransactional({
        workRequestId: row.requestId,
        engagementId: row.engagementId,
        actorId: row.providerId,
      }),
    ]);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: claimed.id } });
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    const paid = payment.status === PaymentStatus.succeeded;
    const cancelled = engagement.status === WorkEngagementStatus.cancelled;
    expect(paid && cancelled).toBe(false);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    if (paid) expect(engagement.status).toBe(WorkEngagementStatus.in_progress);
    if (cancelled) expect(payment.status).not.toBe(PaymentStatus.succeeded);
  });
});
