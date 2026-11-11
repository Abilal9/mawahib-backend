import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ContentModerationService } from './content-moderation.service';

const REVIEW = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';
const ACTOR = { issuer: 'https://staff.example', subjectId: '44444444-4444-4444-8444-444444444444' };

function harness(options: {
  linked?: string | null;
  status?: string;
  hidden?: Date | null;
  version?: number;
  deleted?: Date | null;
  updateCount?: number;
  auditError?: Error;
} = {}) {
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join(' ');
      if (text.includes('FROM staff_members')) {
        return [{
          id: 'staff',
          status: options.status ?? 'active',
          role: 'operator',
          linked_product_user_id: options.linked ?? null,
        }];
      }
      return [{
        id: REVIEW,
        reviewer_id: AUTHOR,
        reviewee_id: SUBJECT,
        engagement_id: '55555555-5555-4555-8555-555555555555',
        engagement_deleted_at: options.deleted ?? null,
        staff_hidden_at: options.hidden ?? null,
        moderation_version: options.version ?? 0,
      }];
    }),
    engagementReview: {
      updateMany: jest.fn(async () => ({ count: options.updateCount ?? 1 })),
    },
    staffAuditEvent: {
      create: jest.fn(async () => {
        if (options.auditError) throw options.auditError;
        return { id: 'audit' };
      }),
    },
    workRequest: { findFirst: jest.fn(async () => ({ id: 'request' })) },
    notification: { create: jest.fn(async () => ({ id: 'notice' })) },
    payment: { update: jest.fn() },
    invoice: { update: jest.fn() },
    contentReport: { update: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  return { service: new ContentModerationService(prisma as never), tx };
}

describe('review moderation', () => {
  it('hides a published review once and leaves money and reports unchanged', async () => {
    const { service, tx } = harness();
    const result = await service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 0,
      reason: 'Harassment in the review.',
    });
    expect(result).toMatchObject({ outcome: 'changed', hidden: true, version: 1 });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientId: AUTHOR,
        body: 'Mawahib hid one of your reviews.',
        payload: { screen: 'work_request', params: { workRequestId: 'request', reviewId: REVIEW } },
      }),
    });
    expect(JSON.stringify(tx.notification.create.mock.calls)).not.toContain('Harassment');
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.contentReport.update).not.toHaveBeenCalled();
  });

  it('does not audit or notify when the review is already hidden', async () => {
    const { service, tx } = harness({ hidden: new Date('2026-11-12T00:00:00.000Z'), version: 2 });
    const result = await service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 0,
      reason: 'Again.',
    });
    expect(result.outcome).toBe('unchanged');
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('rejects a stale version, a linked participant, and an inactive operator', async () => {
    await expect(harness({ version: 3 }).service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 1,
      reason: 'Late.',
    })).rejects.toBeInstanceOf(ConflictException);
    await expect(harness({ linked: AUTHOR }).service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 0,
      reason: 'Self.',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(harness({ linked: SUBJECT }).service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 0,
      reason: 'Self.',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(harness({ status: 'inactive' }).service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 0,
      reason: 'Inactive.',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rolls the hide back when the audit write fails', async () => {
    const { service, tx } = harness({ auditError: new Error('audit down') });
    await expect(service.changeReview(ACTOR, REVIEW, {
      hidden: true,
      expectedVersion: 0,
      reason: 'Needed.',
    })).rejects.toThrow('audit down');
    expect(tx.engagementReview.updateMany).toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
