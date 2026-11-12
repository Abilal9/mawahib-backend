import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ContentModerationService } from './content-moderation.service';

const LISTING = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ACTOR = { issuer: 'https://staff.example', subjectId: '44444444-4444-4444-8444-444444444444' };

function harness(kind: 'job' | 'service', options: {
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
        id: LISTING,
        owner_id: OWNER,
        deleted_at: options.deleted ?? null,
        staff_hidden_at: options.hidden ?? null,
        moderation_version: options.version ?? 0,
      }];
    }),
    jobListing: { updateMany: jest.fn(async () => ({ count: options.updateCount ?? 1 })) },
    serviceOffering: { updateMany: jest.fn(async () => ({ count: options.updateCount ?? 1 })) },
    jobApplication: { updateMany: jest.fn() },
    workRequest: { updateMany: jest.fn() },
    workEngagement: { update: jest.fn() },
    payment: { update: jest.fn() },
    invoice: { update: jest.fn() },
    contentReport: { update: jest.fn() },
    staffAuditEvent: {
      create: jest.fn(async () => {
        if (options.auditError) throw options.auditError;
        return { id: 'audit' };
      }),
    },
    notification: { create: jest.fn(async () => ({ id: 'notice' })) },
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const service = new ContentModerationService(prisma as never);
  const change = kind === 'job'
    ? (body: Record<string, unknown>) => service.changeJob(ACTOR, LISTING, body)
    : (body: Record<string, unknown>) => service.changeService(ACTOR, LISTING, body);
  return { tx, change };
}

describe.each(['job', 'service'] as const)('%s moderation', (kind) => {
  const body = { hidden: true, expectedVersion: 0, reason: 'Policy violation in the listing.' };

  it('hides once, notifies only the owner, and leaves work and money unchanged', async () => {
    const { tx, change } = harness(kind);
    const result = await change(body);
    expect(result).toMatchObject({ outcome: 'changed', hidden: true, version: 1 });
    const updated = kind === 'job' ? tx.jobListing.updateMany : tx.serviceOffering.updateMany;
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({
      data: { staffHiddenAt: expect.any(Date), moderationVersion: { increment: 1 } },
    }));
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientId: OWNER,
        actorId: null,
        body: kind === 'job' ? 'Mawahib hid one of your jobs.' : 'Mawahib hid one of your services.',
        payload: kind === 'job'
          ? { screen: 'job', params: { listingId: LISTING } }
          : { screen: 'service', params: { serviceId: LISTING } },
      }),
    });
    expect(JSON.stringify(tx.notification.create.mock.calls)).not.toContain('Policy violation');
    expect(tx.staffAuditEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.jobApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.workRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.workEngagement.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.contentReport.update).not.toHaveBeenCalled();
  });

  it('does not audit or notify a repeat hide or a restore', async () => {
    const hidden = harness(kind, { hidden: new Date('2026-11-12T00:00:00.000Z'), version: 4 });
    await expect(hidden.change({ ...body, expectedVersion: 1 })).resolves.toMatchObject({ outcome: 'unchanged', version: 4 });
    expect(hidden.tx.staffAuditEvent.create).not.toHaveBeenCalled();
    expect(hidden.tx.notification.create).not.toHaveBeenCalled();

    const restore = harness(kind, { hidden: new Date('2026-11-12T00:00:00.000Z'), version: 4 });
    await expect(restore.change({ hidden: false, expectedVersion: 4, reason: 'Restriction cleared.' })).resolves.toMatchObject({
      outcome: 'changed',
      hidden: false,
      version: 5,
    });
    expect(restore.tx.notification.create).not.toHaveBeenCalled();
    expect(restore.tx.staffAuditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale version, a linked owner, and an inactive operator', async () => {
    await expect(harness(kind, { version: 3 }).change({ ...body, expectedVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(harness(kind, { linked: OWNER }).change(body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(harness(kind, { status: 'inactive' }).change(body)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rolls the hide back when the audit write fails', async () => {
    const { tx, change } = harness(kind, { auditError: new Error('audit down') });
    await expect(change(body)).rejects.toThrow('audit down');
    const updated = kind === 'job' ? tx.jobListing.updateMany : tx.serviceOffering.updateMany;
    expect(updated).toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
