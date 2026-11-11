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
    workEngagement: { update: jest.fn() },
    payment: { update: jest.fn() },
    invoice: { update: jest.fn() },
    contentReport: { update: jest.fn() },
    user: { update: jest.fn() },
    notification: { create: jest.fn() },
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
        assignee_staff_member_id: null,
        client_id: CLIENT_ID,
        provider_id: PROVIDER_ID,
        engagement_status: 'disputed',
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
    const { service, tx, calls } = harness({ engagementStatus: 'disputed' });
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
    const stale = harness({ revision: 3 });
    await expect(stale.service.changeStatus(CASE_ID, ACTOR, {
      action: 'start_review', note: 'Looking', expectedRevision: 1, idempotencyKey: KEY,
    })).rejects.toBeInstanceOf(ConflictException);
    const wrong = harness({ status: 'closed' });
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
    const closed = harness({ status: 'closed', revision: 4 });
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
    })).rejects.toMatchObject({ response: { code: 'DISPUTE_CASE_CLOSED' } });
  });

  it('treats a duplicate insert of the same request as the stored event', async () => {
    const { service, tx } = harness({
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
});
