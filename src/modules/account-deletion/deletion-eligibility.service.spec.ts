import { PaymentStatus, WorkEngagementStatus } from '@prisma/client';
import { DeletionEligibilityService } from './deletion-eligibility.service';

const userId = '11111111-1111-4111-8111-111111111111';
const snapshot = { payerDisplayName: 'A', payeeDisplayName: 'B', description: 'Work' };

function engagement(
  status: WorkEngagementStatus,
  extra: {
    id?: string;
    title?: string;
    payments?: Array<{
      id: string;
      status: PaymentStatus;
      invoice?: {
        status?: string;
        documentMediaAssetId?: string | null;
        payerDisplayName: string | null;
        payeeDisplayName: string | null;
        description: string | null;
      } | null;
    }>;
    followUp?: { followUpRequired: boolean; followUpOutcome: string | null } | null;
  } = {},
) {
  return {
    id: extra.id ?? `eng-${status}`,
    title: extra.title ?? 'Synthetic work',
    status,
    staffClosure: extra.followUp ?? null,
    payments: extra.payments ?? [],
  };
}

function service(rows: ReturnType<typeof engagement>[], options: { user?: boolean; fail?: 'user' | 'engagements' } = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => {
        if (options.fail === 'user') throw new Error('db down');
        return options.user === false ? null : { id: userId };
      }),
    },
    workEngagement: {
      findMany: jest.fn(async () => {
        if (options.fail === 'engagements') throw new Error('db down');
        return rows;
      }),
    },
    workRequest: { findMany: jest.fn() },
  };
  return { service: new DeletionEligibilityService(prisma as never), prisma };
}

describe('deletion eligibility', () => {
  it.each([
    WorkEngagementStatus.declined,
    WorkEngagementStatus.cancelled,
    WorkEngagementStatus.completed,
  ])('allows a %s engagement with no unresolved payment or follow-up', async (status) => {
    const { service: eligibility } = service([
      engagement(status, {
        payments: [
          { id: 'paid', status: PaymentStatus.succeeded, invoice: snapshot },
          { id: 'old', status: PaymentStatus.failed },
        ],
      }),
    ]);
    await expect(eligibility.evaluate(userId)).resolves.toEqual({ status: 'eligible', blockers: [] });
  });

  it.each([
    WorkEngagementStatus.pending_payment,
    WorkEngagementStatus.in_progress,
    WorkEngagementStatus.delivered,
    WorkEngagementStatus.disputed,
    WorkEngagementStatus.payment_failed,
    WorkEngagementStatus.requested,
    WorkEngagementStatus.accepted,
  ])('fails closed for %s', async (status) => {
    const { service: eligibility } = service([engagement(status)]);
    const result = await eligibility.evaluate(userId);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.blockers.map((item) => item.code)).toEqual(['engagement_unresolved']);
    expect(result.blockers[0]?.engagementStatus).toBe(status);
  });

  it('uses the engagement for the four protected shapes and ignores a stale request label', async () => {
    const { service: eligibility, prisma } = service([
      engagement(WorkEngagementStatus.in_progress, { id: 'paid-1', payments: [{ id: 'p1', status: PaymentStatus.succeeded, invoice: snapshot }] }),
      engagement(WorkEngagementStatus.in_progress, { id: 'paid-2', payments: [{ id: 'p2', status: PaymentStatus.succeeded, invoice: snapshot }] }),
      engagement(WorkEngagementStatus.in_progress, { id: 'paid-3', payments: [{ id: 'p3', status: PaymentStatus.succeeded, invoice: snapshot }] }),
      engagement(WorkEngagementStatus.pending_payment, { id: 'unpaid', payments: [] }),
    ]);
    const result = await eligibility.evaluate(userId);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.blockers).toHaveLength(4);
    expect(result.blockers.every((item) => item.code === 'engagement_unresolved')).toBe(true);
    expect(result.blockers.find((item) => item.engagementId === 'unpaid')?.explanation).toBe(
      'Accepted unpaid work has not been cancelled.',
    );
    expect(prisma.workRequest.findMany).not.toHaveBeenCalled();
  });

  it('blocks cancelled work while financial follow-up is outstanding', async () => {
    const { service: eligibility } = service([
      engagement(WorkEngagementStatus.cancelled, {
        followUp: { followUpRequired: true, followUpOutcome: null },
        payments: [{ id: 'paid', status: PaymentStatus.succeeded, invoice: snapshot }],
      }),
    ]);
    const result = await eligibility.evaluate(userId);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'financial_follow_up_outstanding', paymentId: null }),
    ]);
  });

  it('allows cancelled work after follow-up is recorded or not required', async () => {
    const recorded = service([
      engagement(WorkEngagementStatus.cancelled, {
        followUp: { followUpRequired: true, followUpOutcome: 'no_real_funds' },
      }),
    ]);
    const notRequired = service([
      engagement(WorkEngagementStatus.cancelled, {
        followUp: { followUpRequired: false, followUpOutcome: null },
      }),
    ]);
    await expect(recorded.service.evaluate(userId)).resolves.toEqual({ status: 'eligible', blockers: [] });
    await expect(notRequired.service.evaluate(userId)).resolves.toEqual({ status: 'eligible', blockers: [] });
  });

  it('blocks pending and processing attempts and allows a finished history', async () => {
    const pending = service([
      engagement(WorkEngagementStatus.completed, {
        payments: [
          { id: 'old-success', status: PaymentStatus.succeeded, invoice: snapshot },
          { id: 'later', status: PaymentStatus.pending },
        ],
      }),
    ]);
    const processing = service([
      engagement(WorkEngagementStatus.in_progress, {
        payments: [{ id: 'live', status: PaymentStatus.processing }],
      }),
    ]);
    const finished = service([
      engagement(WorkEngagementStatus.completed, {
        payments: [
          { id: 'ok', status: PaymentStatus.succeeded, invoice: snapshot },
          { id: 'no', status: PaymentStatus.cancelled },
        ],
      }),
    ]);
    const pendingResult = await pending.service.evaluate(userId);
    const processingResult = await processing.service.evaluate(userId);
    expect(pendingResult.status).toBe('blocked');
    expect(processingResult.status).toBe('blocked');
    if (pendingResult.status === 'blocked') {
      expect(pendingResult.blockers.map((item) => item.code)).toEqual(['payment_unresolved']);
      expect(pendingResult.blockers[0]?.paymentId).toBe('later');
    }
    if (processingResult.status === 'blocked') {
      expect(processingResult.blockers.map((item) => item.code)).toEqual([
        'engagement_unresolved',
        'payment_unresolved',
      ]);
    }
    await expect(finished.service.evaluate(userId)).resolves.toEqual({ status: 'eligible', blockers: [] });
  });

  it('returns unavailable when the account is missing or a query fails', async () => {
    const missing = service([], { user: false });
    const userDown = service([], { fail: 'user' });
    const engagementDown = service([], { fail: 'engagements' });
    await expect(missing.service.evaluate(userId)).resolves.toEqual({ status: 'unavailable' });
    await expect(userDown.service.evaluate(userId)).resolves.toEqual({ status: 'unavailable' });
    await expect(engagementDown.service.evaluate(userId)).resolves.toEqual({ status: 'unavailable' });
  });

  it('blocks a succeeded payment that has no truthful invoice snapshot', async () => {
    const { service: eligibility } = service([
      engagement(WorkEngagementStatus.completed, {
        payments: [{ id: 'bare', status: PaymentStatus.succeeded, invoice: null }],
      }),
    ]);
    const result = await eligibility.evaluate(userId);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blockers.map((item) => item.code)).toEqual(['invoice_snapshot_unavailable']);
    }
  });

  it('keeps a generated invoice that already has its document', async () => {
    const { service: eligibility } = service([
      engagement(WorkEngagementStatus.completed, {
        payments: [{
          id: 'legacy',
          status: PaymentStatus.succeeded,
          invoice: {
            status: 'generated',
            documentMediaAssetId: 'doc-1',
            payerDisplayName: null,
            payeeDisplayName: null,
            description: null,
          },
        }],
      }),
    ]);
    await expect(eligibility.evaluate(userId)).resolves.toEqual({ status: 'eligible', blockers: [] });
  });

  it('still blocks a generated invoice whose document is missing and has no snapshot', async () => {
    const { service: eligibility } = service([
      engagement(WorkEngagementStatus.completed, {
        payments: [{
          id: 'gap',
          status: PaymentStatus.succeeded,
          invoice: {
            status: 'generated',
            documentMediaAssetId: null,
            payerDisplayName: null,
            payeeDisplayName: null,
            description: null,
          },
        }],
      }),
    ]);
    const result = await eligibility.evaluate(userId);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blockers.map((item) => item.code)).toEqual(['invoice_snapshot_unavailable']);
    }
  });
});
