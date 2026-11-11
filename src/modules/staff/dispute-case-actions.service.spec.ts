import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DisputeCaseActionsService } from './dispute-case-actions.service';

const CASE_ID = '44444444-4444-4444-8444-444444444444';
const STAFF_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '66666666-6666-4666-8666-666666666666';
const PROVIDER_ID = '77777777-7777-4777-8777-777777777777';
const KEY = 'idempotency-key-01';
const ACTOR = { issuer: 'https://staff.example', subjectId: '88888888-8888-4888-8888-888888888888' };

function harness(options: {
  actorStatus?: string;
  linked?: string | null;
  revision?: number;
  status?: string;
  assignee?: string | null;
  engagementStatus?: string;
  existing?: Record<string, unknown> | null;
  updateCount?: number;
  createError?: unknown;
  latest?: boolean;
  openedFrom?: string | null;
  hasDelivery?: boolean;
  hasPayment?: boolean;
  deletedAt?: Date | null;
  engagementMoved?: number;
  notifyError?: unknown;
} = {}) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join(' ');
      if (text.includes('FROM staff_members')) {
        return [{
          id: STAFF_ID,
          status: options.actorStatus ?? 'active',
          role: 'operator',
          linked_product_user_id: options.linked ?? null,
          invited_email: 'ada@example.com',
        }];
      }
      return [{
        id: CASE_ID,
        engagement_id: '99999999-9999-4999-8999-999999999999',
        status: options.status ?? 'open',
        revision: options.revision ?? 0,
        assignee_staff_member_id: options.assignee ?? null,
        client_id: CLIENT_ID,
        provider_id: PROVIDER_ID,
        engagement_status: options.engagementStatus ?? 'disputed',
        is_latest: options.latest ?? true,
        opened_from: options.openedFrom === undefined ? 'delivered' : options.openedFrom,
        has_delivery: options.hasDelivery ?? true,
        has_payment: options.hasPayment ?? true,
        deleted_at: options.deletedAt ?? null,
        title: 'Logo',
      }];
    }),
    disputeCaseEvent: {
      findUnique: jest.fn(async () => options.existing ?? null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        calls.push(`event:${String(args.data.action)}`);
        if (options.createError) throw options.createError;
        return { id: 'event-1', createdAt: new Date('2026-11-10T00:00:00.000Z'), ...args.data };
      }),
    },
    disputeCase: {
      updateMany: jest.fn(async (args: { data: Record<string, unknown> }) => {
        calls.push(`case:${JSON.stringify(args.data.status ?? args.data.assigneeStaffMemberId ?? 'assignment')}`);
        return { count: options.updateCount ?? 1 };
      }),
    },
    staffMember: {
      findUnique: jest.fn(async (): Promise<{ id: string; status: string; role: string; linkedProductUserId: string | null }> => ({
        id: 'assignee',
        status: 'active',
        role: 'operator',
        linkedProductUserId: null,
      })),
    },
    workEngagement: {
      update: jest.fn(),
      updateMany: jest.fn(async () => ({ count: options.engagementMoved ?? 1 })),
    },
    engagementEvent: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'eng-event', ...args.data })),
    },
    payment: { update: jest.fn(), updateMany: jest.fn() },
    invoice: { update: jest.fn(), updateMany: jest.fn() },
    contentReport: { update: jest.fn() },
    user: { update: jest.fn() },
    notification: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        if (options.notifyError) throw options.notifyError;
        return { id: 'notification', ...args.data };
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  return { service: new DisputeCaseActionsService(prisma as never), tx, calls };
}

describe('dispute case actions', () => {
  it('starts review and closes with the following revision', async () => {
    let revision = 0
    let status = 'open'
    const { service, tx } = harness()
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = strings.join(' ')
      if (text.includes('FROM staff_members')) {
        return [{
          id: STAFF_ID,
          status: 'active',
          role: 'operator',
          linked_product_user_id: null,
          invited_email: 'ada@example.com',
        }]
      }
      return [{
        id: CASE_ID,
        engagement_id: '99999999-9999-4999-8999-999999999999',
        status,
        revision,
        assignee_staff_member_id: STAFF_ID,
        client_id: CLIENT_ID,
        provider_id: PROVIDER_ID,
        engagement_status: 'disputed',
        is_latest: true,
        opened_from: 'delivered',
        has_delivery: true,
        has_payment: true,
        deleted_at: null,
        title: 'Logo',
      }]
    })
    tx.disputeCase.updateMany.mockImplementation(async (args: { data: { revision: number; status: string } }) => {
      revision = args.data.revision
      status = args.data.status
      return { count: 1 }
    })
    const started = await service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review',
      note: 'Looking at the delivery',
      expectedRevision: 0,
      idempotencyKey: KEY,
    })
    expect(started.case.revision).toBe(1)
    const closed = await service.changeStatus(CASE_ID, ACTOR, {
      action: 'close',
      outcome: 'no_staff_action',
      note: 'No payment change is needed',
      expectedRevision: 1,
      idempotencyKey: 'idempotency-key-02',
    })
    expect(closed.case).toMatchObject({ status: 'closed', revision: 2 })
    await expect(service.changeStatus(CASE_ID, ACTOR, {
      action: 'reopen',
      note: 'Using the old revision',
      expectedRevision: 0,
      idempotencyKey: 'idempotency-key-03',
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_CONFLICT' } })
    expect(tx.workEngagement.update).not.toHaveBeenCalled()
  })
  it('closes a case without changing the engagement and records the before and after', async () => {
    const { service, tx, calls } = harness({ engagementStatus: 'disputed', assignee: STAFF_ID });
    const result = await service.changeStatus(CASE_ID, ACTOR, {
      action: 'close',
      outcome: 'no_staff_action',
      note: 'Waiting on the parties',
      expectedRevision: 0,
      idempotencyKey: KEY,
    });
    expect(result.outcome).toBe('changed');
    expect(calls[0]).toContain('closed');
    const event = tx.disputeCaseEvent.create.mock.calls[0][0].data;
    expect(event.previousStatus).toBe('open');
    expect(event.resultingStatus).toBe('closed');
    expect(event.previousRevision).toBe(0);
    expect(event.resultingRevision).toBe(1);
    expect(event.engagementStatusAtAction).toBe('disputed');
    expect(event.outcome).toBe('no_staff_action');
    expect(event.note).toBe('Waiting on the parties');
    expect(tx.workEngagement.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.contentReport.update).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.staffMember.findUnique).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('rejects a stale revision, a disallowed transition, an inactive actor, and a linked participant', async () => {
    const stale = harness({ revision: 3, assignee: STAFF_ID });
    await expect(stale.service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review', note: 'Looking', expectedRevision: 1, idempotencyKey: KEY,
    })).rejects.toBeInstanceOf(ConflictException);
    const wrong = harness({ status: 'closed', assignee: STAFF_ID });
    await expect(wrong.service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review', note: 'Looking', expectedRevision: 0, idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_TRANSITION_NOT_ALLOWED' } });
    const inactive = harness({ actorStatus: 'inactive' });
    await expect(inactive.service.addNote(CASE_ID, ACTOR, { body: 'Private', idempotencyKey: KEY })).rejects.toBeInstanceOf(ForbiddenException);
    const self = harness({ linked: CLIENT_ID });
    await expect(self.service.changeAssignment(CASE_ID, ACTOR, {
      assigneeStaffMemberId: null, note: 'Clear', expectedRevision: 0, idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'SELF_ACTION_FORBIDDEN' } });
  });

  it('replays the same request and rejects the same key with a different note', async () => {
    const hash = require('crypto').createHash('sha256').update(JSON.stringify({
      kind: 'note',
      body: 'Private note',
    })).digest('hex');
    const same = harness({
      assignee: STAFF_ID,
      existing: {
        requestHash: hash,
        id: 'event-9',
        note: 'Private note',
        resultingStatus: 'open',
        resultingRevision: 0,
        resultingAssigneeStaffMemberId: null,
        outcome: null,
        createdAt: new Date('2026-11-10T00:00:00.000Z'),
        actor: { invitedEmail: 'ada@example.com' },
      },
    });
    const replayed = await same.service.addNote(CASE_ID, ACTOR, { body: 'Private note', idempotencyKey: KEY });
    expect(replayed).toMatchObject({ outcome: 'replayed', note: { id: 'event-9', body: 'Private note' } });
    expect(same.tx.disputeCaseEvent.create).not.toHaveBeenCalled();
    const different = harness({
      assignee: STAFF_ID,
      existing: {
        requestHash: 'different',
        id: 'event-9',
        note: 'Other',
        resultingStatus: 'open',
        resultingRevision: 0,
        resultingAssigneeStaffMemberId: null,
        outcome: null,
        createdAt: new Date(),
        actor: { invitedEmail: null },
      },
    });
    await expect(different.service.addNote(CASE_ID, ACTOR, { body: 'Private note', idempotencyKey: KEY })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('allows a note on a closed case without changing the revision, and refuses a bad assignee', async () => {
    const closed = harness({ status: 'closed', revision: 4, assignee: STAFF_ID });
    await closed.service.addNote(CASE_ID, ACTOR, { body: 'Still watching', idempotencyKey: KEY });
    expect(closed.tx.disputeCase.updateMany).not.toHaveBeenCalled();
    expect(closed.tx.disputeCaseEvent.create.mock.calls[0][0].data.resultingRevision).toBe(4);
    const unavailable = harness();
    unavailable.tx.staffMember.findUnique.mockResolvedValue({ id: 'x', status: 'inactive', role: 'operator', linkedProductUserId: null });
    await expect(unavailable.service.changeAssignment(CASE_ID, ACTOR, {
      assigneeStaffMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      note: 'Hand off',
      expectedRevision: 0,
      idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'ASSIGNEE_UNAVAILABLE' } });
    const participant = harness();
    participant.tx.staffMember.findUnique.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'active',
      role: 'operator',
      linkedProductUserId: PROVIDER_ID,
    });
    await expect(participant.service.changeAssignment(CASE_ID, ACTOR, {
      assigneeStaffMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      note: 'Hand off',
      expectedRevision: 0,
      idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'ASSIGNEE_IS_PARTICIPANT' } });
    const same = harness({ assignee: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    await expect(same.service.changeAssignment(CASE_ID, ACTOR, {
      assigneeStaffMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      note: 'Again',
      expectedRevision: 0,
      idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_NO_CHANGE' } });
    const locked = harness({ status: 'closed' });
    await expect(locked.service.changeAssignment(CASE_ID, ACTOR, {
      assigneeStaffMemberId: null,
      note: 'Clear',
      expectedRevision: 0,
      idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_NO_CHANGE' } });
  });

  it('treats a duplicate insert of the same request as the stored event', async () => {
    const { service, tx } = harness({
      assignee: STAFF_ID,
      createError: new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }),
    });
    tx.disputeCaseEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'event-existing',
        requestHash: require('crypto').createHash('sha256').update(JSON.stringify({
          kind: 'status',
          action: 'start_review',
          outcome: null,
          note: 'Looking',
          expectedRevision: 0,
        })).digest('hex'),
        resultingStatus: 'in_review',
        resultingRevision: 1,
        resultingAssigneeStaffMemberId: null,
        outcome: null,
      });
    const result = await service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review',
      note: 'Looking',
      expectedRevision: 0,
      idempotencyKey: KEY,
    });
    expect(result.eventId).toBe('event-existing');
  });

  it('rejects handling until the acting operator is the assignee', async () => {
    const unassigned = harness();
    await expect(unassigned.service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review',
      note: 'Looking',
      expectedRevision: 0,
      idempotencyKey: KEY,
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_UNASSIGNED' } });
    await expect(unassigned.service.addNote(CASE_ID, ACTOR, { body: 'Private', idempotencyKey: 'idempotency-key-04' })).rejects.toMatchObject({
      response: { code: 'DISPUTE_CASE_UNASSIGNED' },
    });
    const other = harness({ assignee: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    await expect(other.service.changeStatus(CASE_ID, ACTOR, {
      action: 'close',
      outcome: 'other',
      note: 'Not my case',
      expectedRevision: 0,
      idempotencyKey: 'idempotency-key-05',
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_NOT_ASSIGNEE' } });
    const moved = harness({ assignee: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 2 });
    await expect(moved.service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review',
      note: 'I used to be assigned',
      expectedRevision: 1,
      idempotencyKey: 'idempotency-key-06',
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_NOT_ASSIGNEE' } });
    expect(moved.tx.disputeCase.updateMany).not.toHaveBeenCalled();
    const mine = harness({ assignee: STAFF_ID });
    const started = await mine.service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review',
      note: 'Looking',
      expectedRevision: 0,
      idempotencyKey: 'idempotency-key-07',
    });
    expect(started.case).toMatchObject({ status: 'in_review', revision: 1 });
  });

  it('returns a delivered dispute to client review without touching payments', async () => {
    const { service, tx } = harness({ assignee: STAFF_ID });
    const result = await service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'));
    expect(result).toMatchObject({
      outcome: 'changed',
      case: { status: 'closed', closedOutcome: 'returned_for_client_review' },
      engagement: { previousStatus: 'disputed', status: 'delivered' },
      paymentsChanged: false,
    });
    expect(tx.workEngagement.updateMany).toHaveBeenCalledWith({
      where: { id: '99999999-9999-4999-8999-999999999999', status: 'disputed', deletedAt: null },
      data: { status: 'delivered' },
    });
    expect(tx.engagementEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'disputed', toStatus: 'delivered', actorId: null, note: '' }),
    });
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    const notices = tx.notification.create.mock.calls.map((call: [{ data: { body: string } }]) => call[0].data.body);
    expect(notices).toEqual([
      'This work is ready for your review again.',
      'This work is back with the client for review.',
    ]);
    expect(notices.join(' ')).not.toContain('The client agreed');
  });

  it('returns further work to in progress and keeps the delivery history', async () => {
    const { service, tx } = harness({ assignee: STAFF_ID, status: 'in_review' });
    const result = await service.resolve(CASE_ID, ACTOR, resolutionBody('further_work', { note: 'Both parties agreed the provider will revise the file.' }));
    expect(result.engagement.status).toBe('in_progress');
    expect(result.case).toMatchObject({ status: 'closed', closedOutcome: 'further_work_agreed' });
    expect(tx.engagementEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ toStatus: 'in_progress', note: '' }),
    });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
  });

  it('records follow-up without closing the case or moving the engagement', async () => {
    const { service, tx } = harness({ assignee: STAFF_ID });
    const result = await service.resolve(CASE_ID, ACTOR, resolutionBody('follow_up', { note: 'Waiting for the provider file.' }));
    expect(result).toMatchObject({
      case: { status: 'open', closedOutcome: null },
      engagement: { previousStatus: 'disputed', status: 'disputed' },
      paymentsChanged: false,
    });
    expect(tx.workEngagement.updateMany).not.toHaveBeenCalled();
    expect(tx.disputeCase.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.disputeCaseEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'follow_up_recorded', note: 'Waiting for the provider file.' }),
    });
  });

  it('refuses resolution when delivery, payment, episode, or engagement state does not support it', async () => {
    await expect(harness({ assignee: STAFF_ID, hasDelivery: false }).service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toMatchObject({
      response: { code: 'RESOLUTION_NOT_SUPPORTED' },
    });
    await expect(harness({ assignee: STAFF_ID, openedFrom: 'in_progress' }).service.resolve(CASE_ID, ACTOR, resolutionBody('further_work'))).rejects.toMatchObject({
      response: { code: 'RESOLUTION_NOT_SUPPORTED' },
    });
    await expect(harness({ assignee: STAFF_ID, hasPayment: false }).service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toMatchObject({
      response: { code: 'PAYMENT_PREREQUISITE' },
    });
    await expect(harness({ assignee: STAFF_ID, latest: false }).service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toMatchObject({
      response: { code: 'DISPUTE_CASE_NOT_LATEST' },
    });
    await expect(harness({ assignee: STAFF_ID, engagementStatus: 'delivered' }).service.resolve(CASE_ID, ACTOR, resolutionBody('further_work'))).rejects.toMatchObject({
      response: { code: 'ENGAGEMENT_CHANGED' },
    });
    const moved = harness({ assignee: STAFF_ID, engagementMoved: 0 });
    await expect(moved.service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toMatchObject({
      response: { code: 'ENGAGEMENT_CHANGED' },
    });
    expect(moved.tx.disputeCase.updateMany).not.toHaveBeenCalled();
    expect(moved.tx.notification.create).not.toHaveBeenCalled();
  });

  it('rejects resolution from the wrong operator and replays only the same request', async () => {
    await expect(harness().service.resolve(CASE_ID, ACTOR, resolutionBody('follow_up'))).rejects.toMatchObject({
      response: { code: 'DISPUTE_CASE_UNASSIGNED' },
    });
    await expect(harness({ assignee: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }).service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toMatchObject({
      response: { code: 'DISPUTE_CASE_NOT_ASSIGNEE' },
    });
    await expect(harness({ assignee: STAFF_ID, actorStatus: 'inactive' }).service.resolve(CASE_ID, ACTOR, resolutionBody('follow_up'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(harness({ assignee: STAFF_ID, linked: CLIENT_ID }).service.resolve(CASE_ID, ACTOR, resolutionBody('further_work'))).rejects.toMatchObject({
      response: { code: 'SELF_ACTION_FORBIDDEN' },
    });
    const stale = harness({ assignee: STAFF_ID, revision: 4 });
    await expect(stale.service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toMatchObject({
      response: { code: 'DISPUTE_CASE_CONFLICT' },
    });
    expect(stale.tx.workEngagement.updateMany).not.toHaveBeenCalled();

    const { service, tx } = harness({ assignee: STAFF_ID });
    await service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'));
    const created = tx.disputeCaseEvent.create.mock.calls[0][0].data;
    tx.disputeCaseEvent.findUnique.mockResolvedValue({
      ...created,
      id: 'event-1',
      resultingStatus: 'closed',
      resultingRevision: 1,
      resultingAssigneeStaffMemberId: STAFF_ID,
      engagementStatusAtAction: 'disputed',
      engagementResultingStatus: 'delivered',
      actor: { invitedEmail: 'ada@example.com' },
    });
    tx.workEngagement.updateMany.mockClear();
    tx.notification.create.mockClear();
    tx.engagementEvent.create.mockClear();
    const replayed = await service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'));
    expect(replayed.outcome).toBe('replayed');
    expect(tx.workEngagement.updateMany).not.toHaveBeenCalled();
    expect(tx.engagementEvent.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('rolls the resolution back when the notification write fails', async () => {
    const { service, tx } = harness({ assignee: STAFF_ID, notifyError: new Error('notification down') });
    await expect(service.resolve(CASE_ID, ACTOR, resolutionBody('return_to_client_review'))).rejects.toThrow('notification down');
    expect(tx.workEngagement.updateMany).toHaveBeenCalled();
    expect(tx.disputeCaseEvent.create).toHaveBeenCalled();
  });

  it('keeps administrative closure off the engagement', async () => {
    const { service, tx } = harness({ assignee: STAFF_ID });
    await service.changeStatus(CASE_ID, ACTOR, {
      action: 'close',
      outcome: 'invalid_or_duplicate',
      note: 'Duplicate of an earlier case',
      expectedRevision: 0,
      idempotencyKey: KEY,
    });
    expect(tx.workEngagement.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('replays a committed internal note instead of writing another', async () => {
    const { service, tx } = harness({ assignee: STAFF_ID });
    await service.addNote(CASE_ID, ACTOR, { body: 'Waiting for the file.', idempotencyKey: KEY });
    const created = tx.disputeCaseEvent.create.mock.calls[0][0].data;
    tx.disputeCaseEvent.findUnique.mockResolvedValue({
      ...created,
      id: 'event-1',
      note: 'Waiting for the file.',
      createdAt: new Date('2026-11-11T00:00:00.000Z'),
      actor: { invitedEmail: 'ada@example.com' },
    });
    tx.disputeCaseEvent.create.mockClear();
    const replayed = await service.addNote(CASE_ID, ACTOR, { body: 'Waiting for the file.', idempotencyKey: KEY });
    expect(replayed.outcome).toBe('replayed');
    expect(tx.disputeCaseEvent.create).not.toHaveBeenCalled();
  });
});

function resolutionBody(action: string, extra: Record<string, unknown> = {}) {
  return {
    action,
    note: 'The client agreed to review the existing delivery.',
    expectedRevision: 0,
    expectedEngagementStatus: 'disputed',
    idempotencyKey: KEY,
    ...extra,
  };
}
