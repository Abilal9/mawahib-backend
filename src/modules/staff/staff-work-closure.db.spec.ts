import { PrismaClient, WorkEngagementStatus } from '@prisma/client';
import { DisputeCaseActionsService } from './dispute-case-actions.service';

const databaseUrl = process.env.STAFF_CLOSURE_DATABASE_URL;

describe('staff closure transaction', () => {
  if (!databaseUrl) {
    it.skip('requires STAFF_CLOSURE_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const actions = new DisputeCaseActionsService(prisma as never);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(paymentStatus: 'succeeded' | 'processing' | 'none' = 'succeeded') {
    const clientId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const engagementId = crypto.randomUUID();
    const staffSubject = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: clientId,
        email: `${clientId}@closure.test`,
        accountType: 'business',
        displayName: 'Client',
        username: `c${clientId.slice(0, 12)}`,
      },
    });
    await prisma.user.create({
      data: {
        id: providerId,
        email: `${providerId}@closure.test`,
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
        title: 'Stalled work',
        status: WorkEngagementStatus.disputed,
        source: 'direct',
      },
    });
    const opening = await prisma.engagementEvent.create({
      data: {
        engagementId,
        fromStatus: WorkEngagementStatus.in_progress,
        toStatus: WorkEngagementStatus.disputed,
        actorId: clientId,
        note: 'Please review',
      },
    });
    const staff = await prisma.staffMember.create({
      data: {
        issuer: 'https://staff.example/auth/v1',
        subjectId: staffSubject,
        status: 'active',
      },
    });
    const dispute = await prisma.disputeCase.create({
      data: {
        engagementId,
        openedEventId: opening.id,
        origin: 'dispute_event',
        status: 'in_review',
        assigneeStaffMemberId: staff.id,
      },
    });
    let paymentId: string | null = null;
    if (paymentStatus !== 'none') {
      const payment = await prisma.payment.create({
        data: {
          engagementId,
          payerUserId: clientId,
          payeeUserId: providerId,
          amount: '40.00',
          currency: 'SAR',
          method: 'card',
          provider: 'mock',
          status: paymentStatus,
          providerReference: 'mock_ref',
          idempotencyKey: crypto.randomUUID(),
          ...(paymentStatus === 'succeeded' ? { settlementKey: engagementId } : {}),
        },
      });
      paymentId = payment.id;
      if (paymentStatus === 'succeeded') {
        await prisma.invoice.create({
          data: {
            engagementId,
            paymentId: payment.id,
            invoiceNumber: `MWH-CLOSE-${payment.id.slice(0, 8)}`,
            provider: 'mock',
            status: 'generated',
            currency: 'SAR',
            subtotal: '40.00',
            taxAmount: '0.00',
            total: '40.00',
            payerDisplayName: 'Client',
            payeeDisplayName: 'Provider',
            description: 'Stalled work',
            paymentReference: 'mock_ref',
          },
        });
      }
    }
    return { clientId, providerId, engagementId, staffSubject, caseId: dispute.id, paymentId };
  }

  function body(key: string) {
    return {
      reason: 'The work has stalled and both sides asked for a decision.',
      expectedRevision: 0,
      expectedEngagementStatus: 'disputed',
      confirmedTitle: 'Stalled work',
      idempotencyKey: key,
      initiation: { category: 'staff_observation' },
      financialFollowUpRequired: false,
    };
  }

  it('closes disputed work without touching the payment, invoice, or review window', async () => {
    const row = await seed();
    const actor = { issuer: 'https://staff.example/auth/v1', subjectId: row.staffSubject };
    const key = crypto.randomUUID();
    const result = await actions.closeWork(row.caseId, actor, body(key));
    expect(result.outcome).toBe('changed');
    expect(result.engagement.status).toBe('cancelled');

    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe('cancelled');
    expect(engagement.staffClosedAt).not.toBeNull();
    expect(engagement.completedAt).toBeNull();
    expect(engagement.reviewWindowClosesAt).toBeNull();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentId! } });
    expect(payment.status).toBe('succeeded');
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { paymentId: row.paymentId! } });
    expect(invoice.status).toBe('generated');
    const notes = await prisma.notification.findMany({ where: { recipientId: { in: [row.clientId, row.providerId] } } });
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.body === 'Mawahib closed this work. Payments and invoices are unchanged.')).toBe(true);
    expect(notes.some((note) => note.body.includes('stalled'))).toBe(false);

    const replay = await actions.closeWork(row.caseId, actor, body(key));
    expect(replay.outcome).toBe('replayed');
    expect(await prisma.engagementEvent.count({
      where: { engagementId: row.engagementId, toStatus: 'cancelled' },
    })).toBe(1);
    expect(await prisma.notification.count({
      where: { recipientId: { in: [row.clientId, row.providerId] } },
    })).toBe(2);
  });

  it('refuses a processing payment and leaves the dispute open', async () => {
    const row = await seed('processing');
    await expect(actions.closeWork(row.caseId, {
      issuer: 'https://staff.example/auth/v1',
      subjectId: row.staffSubject,
    }, body(crypto.randomUUID()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_HISTORY_UNSUPPORTED' }) as object,
    });
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe('disputed');
    expect(engagement.staffClosedAt).toBeNull();
  });

  it('lets closure and client acceptance finish as one outcome', async () => {
    const row = await seed('none');
    const actor = { issuer: 'https://staff.example/auth/v1', subjectId: row.staffSubject };
    const accept = prisma.workEngagement.updateMany({
      where: { id: row.engagementId, status: 'disputed' },
      data: {
        status: 'completed',
        completedAt: new Date(),
        reviewWindowClosesAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    const results = await Promise.allSettled([
      actions.closeWork(row.caseId, actor, body(crypto.randomUUID())),
      accept,
    ]);
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(['cancelled', 'completed']).toContain(engagement.status);
    if (engagement.status === 'cancelled') {
      expect(engagement.staffClosedAt).not.toBeNull();
      expect(engagement.reviewWindowClosesAt).toBeNull();
    } else {
      expect(engagement.staffClosedAt).toBeNull();
      expect(engagement.reviewWindowClosesAt).not.toBeNull();
    }
    expect(results.filter((item) => item.status === 'fulfilled').length).toBeGreaterThan(0);
  });

  it('closes in-progress work without a case and records follow-up without changing the payment', async () => {
    const clientId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const engagementId = crypto.randomUUID();
    const staffSubject = crypto.randomUUID();
    await prisma.user.create({ data: { id: clientId, email: `${clientId}@closure.test`, accountType: 'business', displayName: 'Client', username: `c${clientId.slice(0, 12)}` } });
    await prisma.user.create({ data: { id: providerId, email: `${providerId}@closure.test`, accountType: 'talent', displayName: 'Provider', username: `p${providerId.slice(0, 12)}` } });
    await prisma.workEngagement.create({ data: { id: engagementId, clientId, providerId, title: 'Stalled work', status: 'in_progress', source: 'direct' } });
    const payment = await prisma.payment.create({
      data: {
        engagementId,
        payerUserId: clientId,
        payeeUserId: providerId,
        amount: '40.00',
        currency: 'SAR',
        method: 'card',
        provider: 'mock',
        status: 'succeeded',
        providerReference: 'mock_ref',
        idempotencyKey: crypto.randomUUID(),
        settlementKey: engagementId,
      },
    });
    await prisma.staffMember.create({ data: { issuer: 'https://staff.example/auth/v1', subjectId: staffSubject, status: 'active' } });
    const actor = { issuer: 'https://staff.example/auth/v1', subjectId: staffSubject };
    const key = crypto.randomUUID();
    const closed = await actions.closeFromEngagement(engagementId, actor, {
      reason: 'Support asked Mawahib to end this stalled engagement.',
      expectedEngagementStatus: 'in_progress',
      confirmedTitle: 'Stalled work',
      idempotencyKey: key,
      initiation: { category: 'support_request', reference: 'desk-14' },
      financialFollowUpRequired: true,
    });
    expect(closed.outcome).toBe('changed');
    const replay = await actions.closeFromEngagement(engagementId, actor, {
      reason: 'Support asked Mawahib to end this stalled engagement.',
      expectedEngagementStatus: 'in_progress',
      confirmedTitle: 'Stalled work',
      idempotencyKey: key,
      initiation: { category: 'support_request', reference: 'desk-14' },
      financialFollowUpRequired: true,
    });
    expect(replay.outcome).toBe('replayed');
    expect(await prisma.engagementEvent.count({ where: { engagementId, note: 'Closed by Mawahib' } })).toBe(1);
    const followKey = crypto.randomUUID();
    const recorded = await actions.recordFinancialFollowUp(engagementId, actor, {
      outcome: 'no_real_funds',
      note: 'The succeeded payment was simulated. No real funds moved.',
      idempotencyKey: followKey,
    });
    expect(recorded.outcome).toBe('changed');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('succeeded');
    const again = await actions.recordFinancialFollowUp(engagementId, actor, {
      outcome: 'no_real_funds',
      note: 'The succeeded payment was simulated. No real funds moved.',
      idempotencyKey: followKey,
    });
    expect(again.outcome).toBe('replayed');
  });

  it('does not let the engagement command bypass an open dispute case', async () => {
    const row = await seed('none');
    await expect(actions.closeFromEngagement(row.engagementId, {
      issuer: 'https://staff.example/auth/v1',
      subjectId: row.staffSubject,
    }, {
      reason: 'Trying to close around the assigned case.',
      expectedEngagementStatus: 'disputed',
      confirmedTitle: 'Stalled work',
      idempotencyKey: crypto.randomUUID(),
      initiation: { category: 'staff_observation' },
      financialFollowUpRequired: false,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DISPUTE_CASE_OPEN' }) as object });
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe('disputed');
    expect(engagement.staffClosedAt).toBeNull();
  });
});
