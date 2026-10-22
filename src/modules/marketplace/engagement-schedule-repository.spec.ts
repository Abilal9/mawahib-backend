import {
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestStatus,
} from '@prisma/client';
import { PrismaMarketplaceRepository } from './repositories/prisma-marketplace.repository';
import { toJson, type WorkRequestTerms } from './work-request-terms';
import { utcDateFromIso } from './engagement-schedule';

const engagementId = '00000000-0000-4000-8000-000000000010';
const requestId = '00000000-0000-4000-8000-000000000011';

function terms(deadline: WorkRequestTerms['deadline']): WorkRequestTerms {
  return {
    title: 'Studio shoot',
    scope: 'Half day',
    money: { amount: 500, currency: 'SAR' },
    deadline,
    notes: 'Bring lights',
  };
}

describe('engagement schedule writes', () => {
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    workRequest: {
      findFirst: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    workEngagement: {
      create: jest.fn(async () => ({ id: engagementId })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => ({ id: engagementId })),
    },
    workRequestEvent: { create: jest.fn(async () => ({})) },
    engagementEvent: { create: jest.fn(async () => ({})) },
    engagementSchedule: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ engagementId })),
      delete: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    workRequest: {
      findFirst: jest.fn(async () => ({ id: requestId })),
    },
    workEngagement: {
      findFirst: jest.fn(async () => ({ id: engagementId })),
    },
  };
  const repo = new PrismaMarketplaceRepository(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.workEngagement.updateMany.mockResolvedValue({ count: 1 });
    tx.workRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.engagementSchedule.findUnique.mockResolvedValue(null);
  });

  it('creates an exact-date schedule inside acceptance and leaves the terms untouched', async () => {
    const agreed = terms({ type: 'exact_date', startDate: '2026-10-22' });
    const before = JSON.stringify(agreed);
    tx.workRequest.findFirst.mockResolvedValue({
      id: requestId,
      workEngagementId: null,
      status: WorkRequestStatus.pending,
      jobListingId: null,
      jobApplicationId: null,
      serviceOfferingId: null,
      clientUserId: 'client',
      providerUserId: 'provider',
      title: 'Studio shoot',
      senderUserId: 'client',
    });

    await repo.acceptWorkRequestTransactional({
      workRequestId: requestId,
      actorId: 'provider',
      agreedTerms: agreed,
      eventType: WorkRequestEventType.accepted,
      engagementSource: WorkEngagementSource.service_request,
      expectedStatus: WorkRequestStatus.pending,
    });

    expect(JSON.stringify(agreed)).toBe(before);
    const created = tx.workEngagement.create.mock.calls[0][0].data;
    expect(created.schedule.create).toEqual({
      kind: 'deadline',
      startDate: utcDateFromIso('2026-10-22'),
      endDate: utcDateFromIso('2026-10-22'),
      source: 'agreed_terms',
    });
    expect(created.dueAt).toBeUndefined();
    expect(tx.workRequest.updateMany.mock.calls[0][0].data.agreedTermsJson).toEqual(
      toJson(agreed),
    );
  });

  it('creates a deadline range and omits a row for flexible and duration', async () => {
    tx.workRequest.findFirst.mockResolvedValue({
      id: requestId,
      workEngagementId: null,
      status: WorkRequestStatus.pending,
      jobApplicationId: null,
      clientUserId: 'client',
      providerUserId: 'provider',
      title: 'Studio shoot',
      senderUserId: 'client',
    });
    const accept = (deadline: WorkRequestTerms['deadline']) =>
      repo.acceptWorkRequestTransactional({
        workRequestId: requestId,
        actorId: 'provider',
        agreedTerms: terms(deadline),
        eventType: WorkRequestEventType.accepted,
        engagementSource: WorkEngagementSource.direct,
        expectedStatus: WorkRequestStatus.pending,
      });

    await accept({
      type: 'date_range',
      startDate: '2026-10-22',
      endDate: '2026-10-25',
    });
    expect(tx.workEngagement.create.mock.calls[0][0].data.schedule.create).toMatchObject({
      kind: 'deadline_range',
      source: 'agreed_terms',
    });

    await accept({ type: 'flexible' });
    expect(tx.workEngagement.create.mock.calls[1][0].data.schedule).toBeUndefined();

    await accept({ type: 'duration', durationValue: 3, durationUnit: 'days' });
    expect(tx.workEngagement.create.mock.calls[2][0].data.schedule).toBeUndefined();
  });

  it('rolls the acceptance back when the engagement insert fails', async () => {
    tx.workRequest.findFirst.mockResolvedValue({
      id: requestId,
      workEngagementId: null,
      status: WorkRequestStatus.pending,
      jobApplicationId: null,
      clientUserId: 'client',
      providerUserId: 'provider',
      title: 'Studio shoot',
      senderUserId: 'client',
    });
    tx.workEngagement.create.mockRejectedValueOnce(new Error('schedule insert failed'));

    await expect(
      repo.acceptWorkRequestTransactional({
        workRequestId: requestId,
        actorId: 'provider',
        agreedTerms: terms({ type: 'exact_date', startDate: '2026-10-22' }),
        eventType: WorkRequestEventType.accepted,
        engagementSource: WorkEngagementSource.service_request,
        expectedStatus: WorkRequestStatus.pending,
      }),
    ).rejects.toThrow('schedule insert failed');
    expect(tx.workRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.workRequestEvent.create).not.toHaveBeenCalled();
  });

  it('resolves a duration on the first start and not on a revision or a lost race', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T12:00:00.000Z') });
    try {
    tx.workRequest.findFirst.mockResolvedValue({
      agreedTermsJson: {
        title: 'Studio shoot',
        deadline: { type: 'duration', durationValue: 3, durationUnit: 'days' },
      },
    });

    await repo.transitionEngagement({
      id: engagementId,
      from: WorkEngagementStatus.pending_payment,
      to: WorkEngagementStatus.in_progress,
      actorId: 'payer',
      note: 'Payment received — work started',
    });

    expect(tx.engagementEvent.create.mock.calls[0][0].data.createdAt).toEqual(
      new Date('2026-10-22T12:00:00.000Z'),
    );
    expect(tx.engagementSchedule.create).toHaveBeenCalledWith({
      data: {
        engagementId,
        kind: 'deadline',
        startDate: utcDateFromIso('2026-10-25'),
        endDate: utcDateFromIso('2026-10-25'),
        source: 'resolved_duration',
      },
    });

    tx.engagementSchedule.create.mockClear();
    await repo.transitionEngagement({
      id: engagementId,
      from: WorkEngagementStatus.delivered,
      to: WorkEngagementStatus.in_progress,
      actorId: 'client',
      note: 'Please revise',
    });
    expect(tx.engagementSchedule.create).not.toHaveBeenCalled();

    tx.workEngagement.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repo.transitionEngagement({
        id: engagementId,
        from: WorkEngagementStatus.pending_payment,
        to: WorkEngagementStatus.in_progress,
        actorId: 'payer',
      }),
    ).rejects.toThrow('updated by another request');
    expect(tx.engagementSchedule.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not replace an agreed schedule or invent one for a bad duration', async () => {
    tx.engagementSchedule.findUnique.mockResolvedValue({ engagementId });
    tx.workRequest.findFirst.mockResolvedValue({
      agreedTermsJson: {
        deadline: { type: 'duration', durationValue: 3, durationUnit: 'days' },
      },
    });
    await repo.transitionEngagement({
      id: engagementId,
      from: WorkEngagementStatus.pending_payment,
      to: WorkEngagementStatus.in_progress,
      actorId: 'payer',
    });
    expect(tx.engagementSchedule.create).not.toHaveBeenCalled();

    tx.engagementSchedule.findUnique.mockResolvedValue(null);
    tx.workRequest.findFirst.mockResolvedValue({
      agreedTermsJson: {
        deadline: { type: 'duration', durationValue: 'soon', durationUnit: 'days' },
      },
    });
    await expect(
      repo.transitionEngagement({
        id: engagementId,
        from: WorkEngagementStatus.pending_payment,
        to: WorkEngagementStatus.in_progress,
        actorId: 'payer',
      }),
    ).resolves.toEqual({ id: engagementId });
    expect(tx.engagementSchedule.create).not.toHaveBeenCalled();
  });

  it('keeps a schedule row when pending payment is withdrawn and when work completes', async () => {
    tx.workEngagement.updateMany.mockResolvedValue({ count: 1 });
    tx.workRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.workRequest.findFirst.mockResolvedValue({ id: requestId });

    await repo.withdrawPendingPaymentTransactional({
      workRequestId: requestId,
      engagementId,
      actorId: 'client',
    });
    expect(tx.engagementSchedule.delete).not.toHaveBeenCalled();
    expect(tx.workEngagement.updateMany.mock.calls[0][0].data).toEqual({
      status: WorkEngagementStatus.cancelled,
    });

    await repo.transitionEngagement({
      id: engagementId,
      from: WorkEngagementStatus.delivered,
      to: WorkEngagementStatus.completed,
      actorId: 'client',
    });
    expect(tx.engagementSchedule.create).not.toHaveBeenCalled();
    expect(tx.engagementSchedule.delete).not.toHaveBeenCalled();
  });
});
