import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, WorkEngagementStatus } from '@prisma/client';
import { PrismaMarketplaceRepository } from '../marketplace/repositories/prisma-marketplace.repository';
import { PrismaPaymentRepository } from '../payments/repositories/prisma-payment.repository';
import { DisputeCaseActionsService } from './dispute-case-actions.service';

describe('staff unpaid cancellation stays out of deletion', () => {
  it('is not called by a deletion request or confirmation', () => {
    const closure = readFileSync(join(__dirname, '../account-deletion/deletion-closure.service.ts'), 'utf8');
    const request = readFileSync(join(__dirname, '../account-deletion/deletion-request.service.ts'), 'utf8');
    expect(closure).not.toContain('cancelUnpaid');
    expect(closure).not.toContain('staff_unpaid');
    expect(request).not.toContain('cancelUnpaid');
    expect(request).not.toContain('staff_unpaid');
  });
});

const databaseUrl = process.env.STAFF_UNPAID_DATABASE_URL;

describe('staff unpaid cancellation', () => {
  if (!databaseUrl) {
    it.skip('requires STAFF_UNPAID_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const actions = new DisputeCaseActionsService(prisma as never);
  const payments = new PrismaPaymentRepository(prisma as never);
  const marketplace = new PrismaMarketplaceRepository(prisma as never);
  const issuer = 'https://staff.example/auth/v1';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(options?: {
    status?: WorkEngagementStatus;
    title?: string;
    staffStatus?: 'active' | 'pending';
    link?: 'client' | null;
    caseMode?: 'none' | 'unassigned' | 'assignee' | 'other';
    attempts?: Array<{
      status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
      reference?: string | null;
      failureCode?: string | null;
      invoice?: boolean;
    }>;
    workRequest?: boolean;
  }) {
    const clientId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const engagementId = crypto.randomUUID();
    const staffSubject = crypto.randomUUID();
    const title = options?.title ?? 'Accepted unpaid work';
    await prisma.user.create({
      data: {
        id: clientId,
        email: `${clientId}@unpaid.test`,
        accountType: 'business',
        displayName: 'Client',
        username: `c${clientId.slice(0, 12)}`,
      },
    });
    await prisma.user.create({
      data: {
        id: providerId,
        email: `${providerId}@unpaid.test`,
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
        title,
        status: options?.status ?? WorkEngagementStatus.pending_payment,
        source: 'direct',
      },
    });
    const requestId = options?.workRequest === false ? null : crypto.randomUUID();
    if (requestId) {
      await prisma.workRequest.create({
        data: {
          id: requestId,
          source: 'direct_request',
          senderUserId: providerId,
          recipientUserId: clientId,
          clientUserId: clientId,
          providerUserId: providerId,
          workEngagementId: engagementId,
          title,
          status: 'pending_payment',
          termsJson: {},
        },
      });
    }
    const staff = await prisma.staffMember.create({
      data: {
        issuer,
        subjectId: staffSubject,
        status: options?.staffStatus ?? 'active',
        linkedProductUserId: options?.link === 'client' ? clientId : null,
      },
    });
    let otherSubject: string | null = null;
    if (options?.caseMode && options.caseMode !== 'none') {
      const opening = await prisma.engagementEvent.create({
        data: {
          engagementId,
          fromStatus: WorkEngagementStatus.pending_payment,
          toStatus: WorkEngagementStatus.pending_payment,
          actorId: clientId,
          note: 'Opened for review',
        },
      });
      let assigneeId: string | null = null;
      if (options.caseMode === 'assignee') assigneeId = staff.id;
      if (options.caseMode === 'other') {
        otherSubject = crypto.randomUUID();
        const other = await prisma.staffMember.create({
          data: { issuer, subjectId: otherSubject, status: 'active' },
        });
        assigneeId = other.id;
      }
      await prisma.disputeCase.create({
        data: {
          engagementId,
          openedEventId: opening.id,
          origin: 'dispute_event',
          status: 'open',
          assigneeStaffMemberId: assigneeId,
        },
      });
    }
    const paymentIds: string[] = [];
    for (const attempt of options?.attempts ?? []) {
      const payment = await prisma.payment.create({
        data: {
          engagementId,
          payerUserId: clientId,
          payeeUserId: providerId,
          amount: '25.00',
          currency: 'SAR',
          method: 'card',
          provider: 'mock',
          status: attempt.status,
          providerReference: attempt.reference ?? null,
          failureCode: attempt.failureCode ?? null,
          idempotencyKey: crypto.randomUUID(),
          ...(attempt.status === 'succeeded' ? { settlementKey: `${engagementId}-${paymentIds.length}` } : {}),
        },
      });
      paymentIds.push(payment.id);
      if (attempt.invoice) {
        await prisma.invoice.create({
          data: {
            engagementId,
            paymentId: payment.id,
            invoiceNumber: `MWH-UNPAID-${payment.id.slice(0, 8)}`,
            provider: 'mock',
            status: 'generated',
            currency: 'SAR',
            subtotal: '25.00',
            taxAmount: '0.00',
            total: '25.00',
            payerDisplayName: 'Client',
            payeeDisplayName: 'Provider',
            description: title,
          },
        });
      }
    }
    return { clientId, providerId, engagementId, requestId, staffSubject, otherSubject, paymentIds, title };
  }

  function body(key: string, title = 'Accepted unpaid work', reason = 'The accepted work was abandoned before payment.') {
    return {
      reason,
      expectedEngagementStatus: 'pending_payment',
      confirmedTitle: title,
      idempotencyKey: key,
    };
  }

  function actor(subjectId: string) {
    return { issuer, subjectId };
  }

  async function cancel(row: { engagementId: string; staffSubject: string; title: string }, key = crypto.randomUUID(), reason?: string) {
    return actions.cancelUnpaidFromEngagement(row.engagementId, actor(row.staffSubject), body(key, row.title, reason));
  }

  async function expectUnchanged(engagementId: string, status: WorkEngagementStatus = WorkEngagementStatus.pending_payment) {
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: engagementId } });
    expect(engagement.status).toBe(status);
    expect(engagement.staffClosedAt).toBeNull();
    expect(await prisma.staffUnpaidCancellation.count({ where: { engagementId } })).toBe(0);
    expect(await prisma.engagementStaffClosure.count({ where: { engagementId } })).toBe(0);
    expect(await prisma.engagementEvent.count({
      where: { engagementId, note: 'Cancelled by Mawahib' },
    })).toBe(0);
  }

  it('cancels accepted work that has no payment attempts', async () => {
    const row = await seed();
    const result = await cancel(row);
    expect(result.outcome).toBe('changed');
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe('cancelled');
    expect(engagement.staffClosedAt).toBeNull();
    expect(await prisma.engagementStaffClosure.count({ where: { engagementId: row.engagementId } })).toBe(0);
    const request = await prisma.workRequest.findUniqueOrThrow({ where: { id: row.requestId! } });
    expect(request.status).toBe('withdrawn');
    const event = await prisma.engagementEvent.findFirstOrThrow({
      where: { engagementId: row.engagementId, toStatus: 'cancelled' },
    });
    expect(event.note).toBe('Cancelled by Mawahib');
    expect(event.actorId).toBeNull();
    const notes = await prisma.notification.findMany({
      where: { recipientId: { in: [row.clientId, row.providerId] } },
    });
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.actorId === null)).toBe(true);
    expect(notes.every((note) => note.body === 'Mawahib cancelled this unpaid work. No refund is issued.')).toBe(true);
    expect(notes.some((note) => note.body.includes('abandoned'))).toBe(false);
    const audit = await prisma.staffAuditEvent.findFirstOrThrow({
      where: { action: 'staff_unpaid_work_cancelled', targetSubjectId: row.engagementId },
    });
    expect(audit.reason).toBe('The accepted work was abandoned before payment.');
  });

  it('cancels an unstarted mock pending attempt and leaves a failed attempt unchanged', async () => {
    const row = await seed({
      attempts: [
        { status: 'failed', failureCode: 'card_declined', reference: 'failed-ref' },
        { status: 'cancelled', failureCode: 'buyer_cancelled' },
        { status: 'pending' },
      ],
    });
    await cancel(row);
    const attempts = await prisma.payment.findMany({ where: { engagementId: row.engagementId }, orderBy: { createdAt: 'asc' } });
    expect(attempts.map((item) => item.status)).toEqual(['failed', 'cancelled', 'cancelled']);
    expect(attempts[0].failureCode).toBe('card_declined');
    expect(attempts[0].providerReference).toBe('failed-ref');
    expect(attempts[1].failureCode).toBe('buyer_cancelled');
    expect(attempts[2].failureCode).toBe('cancelled_before_start');
    expect(attempts[2].failureMessage).toBe('Cancelled before the payment started.');
    expect(await prisma.invoice.count({ where: { engagementId: row.engagementId } })).toBe(0);
  });

  it('refuses a pending attempt that already has a provider reference', async () => {
    const row = await seed({ attempts: [{ status: 'pending', reference: 'provider-ref' }] });
    await expect(cancel(row)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_HISTORY_UNSUPPORTED' }) as object,
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentIds[0] } });
    expect(payment.status).toBe('pending');
    expect(payment.providerReference).toBe('provider-ref');
    await expectUnchanged(row.engagementId);
  });

  it('refuses a processing attempt', async () => {
    const row = await seed({ attempts: [{ status: 'processing', reference: 'processing-ref' }] });
    await expect(cancel(row)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_HISTORY_UNSUPPORTED' }) as object,
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentIds[0] } });
    expect(payment.status).toBe('processing');
    await expectUnchanged(row.engagementId);
  });

  it('refuses a succeeded attempt and leaves its invoice unchanged', async () => {
    const row = await seed({ attempts: [{ status: 'succeeded', reference: 'paid-ref', invoice: true }] });
    await expect(cancel(row)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_HISTORY_UNSUPPORTED' }) as object,
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentIds[0] } });
    expect(payment.status).toBe('succeeded');
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { paymentId: payment.id } });
    expect(invoice.status).toBe('generated');
    expect(invoice.invoiceNumber).toBe(`MWH-UNPAID-${payment.id.slice(0, 8)}`);
    expect(invoice.total.toFixed(2)).toBe('25.00');
    await expectUnchanged(row.engagementId);
  });

  it('refuses an earlier success followed by a later failure', async () => {
    const row = await seed({
      attempts: [
        { status: 'succeeded', reference: 'paid-ref', invoice: true },
        { status: 'failed', failureCode: 'later_failure' },
      ],
    });
    await expect(cancel(row)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_HISTORY_UNSUPPORTED' }) as object,
    });
    const attempts = await prisma.payment.findMany({ where: { engagementId: row.engagementId }, orderBy: { createdAt: 'asc' } });
    expect(attempts.map((item) => item.status)).toEqual(['succeeded', 'failed']);
    expect(await prisma.invoice.count({ where: { engagementId: row.engagementId, status: 'generated' } })).toBe(1);
    await expectUnchanged(row.engagementId);
  });

  it('refuses work that is not awaiting payment', async () => {
    const row = await seed({ status: WorkEngagementStatus.in_progress });
    await expect(cancel(row)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENGAGEMENT_CHANGED' }) as object,
    });
    await expectUnchanged(row.engagementId, WorkEngagementStatus.in_progress);
    await expect(actions.cancelUnpaidFromEngagement(row.engagementId, actor(row.staffSubject), {
      ...body(crypto.randomUUID(), row.title),
      expectedEngagementStatus: 'in_progress',
    })).rejects.toThrow('only applies while payment is still outstanding');
  });

  it('refuses inactive staff and a linked participant', async () => {
    const inactive = await seed({ staffStatus: 'pending' });
    await expect(cancel(inactive)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STAFF_ACCESS_DENIED' }) as object,
    });
    await expectUnchanged(inactive.engagementId);
    const linked = await seed({ link: 'client' });
    await expect(cancel(linked)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SELF_ACTION_FORBIDDEN' }) as object,
    });
    await expectUnchanged(linked.engagementId);
  });

  it('follows the open-case assignment rule', async () => {
    const unassigned = await seed({ caseMode: 'unassigned' });
    await expect(cancel(unassigned)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DISPUTE_CASE_UNASSIGNED' }) as object,
    });
    await expectUnchanged(unassigned.engagementId);
    const other = await seed({ caseMode: 'other' });
    await expect(cancel(other)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DISPUTE_CASE_NOT_ASSIGNEE' }) as object,
    });
    await expectUnchanged(other.engagementId);
    const assigned = await seed({ caseMode: 'assignee' });
    const result = await cancel(assigned);
    expect(result.outcome).toBe('changed');
    expect((await prisma.workEngagement.findUniqueOrThrow({ where: { id: assigned.engagementId } })).status).toBe('cancelled');
  });

  it('replays the same key and rejects a different payload', async () => {
    const row = await seed();
    const key = crypto.randomUUID();
    const first = await cancel(row, key);
    const replay = await cancel(row, key);
    expect(replay.outcome).toBe('replayed');
    expect(replay.cancellationId).toBe(first.cancellationId);
    expect(await prisma.staffAuditEvent.count({
      where: { action: 'staff_unpaid_work_cancelled', targetSubjectId: row.engagementId },
    })).toBe(1);
    expect(await prisma.notification.count({
      where: { recipientId: { in: [row.clientId, row.providerId] } },
    })).toBe(2);
    await expect(cancel(row, key, 'A different private reason.')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }) as object,
    });
    expect(await prisma.notification.count({
      where: { recipientId: { in: [row.clientId, row.providerId] } },
    })).toBe(2);
  });

  it('rejects a stale title and a concurrent participant cancellation', async () => {
    const stale = await seed();
    await expect(actions.cancelUnpaidFromEngagement(
      stale.engagementId,
      actor(stale.staffSubject),
      body(crypto.randomUUID(), 'A different title'),
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENGAGEMENT_CHANGED' }) as object,
    });
    await expectUnchanged(stale.engagementId);

    const row = await seed({ attempts: [{ status: 'pending' }] });
    const results = await Promise.allSettled([
      cancel(row),
      marketplace.withdrawPendingPaymentTransactional({
        workRequestId: row.requestId!,
        engagementId: row.engagementId,
        actorId: row.providerId,
      }),
    ]);
    expect(results.some((item) => item.status === 'fulfilled')).toBe(true);
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe('cancelled');
    expect(engagement.staffClosedAt).toBeNull();
    const notes = await prisma.engagementEvent.findMany({
      where: { engagementId: row.engagementId, toStatus: 'cancelled' },
    });
    expect(notes).toHaveLength(1);
    const staffRows = await prisma.staffUnpaidCancellation.count({ where: { engagementId: row.engagementId } });
    if (notes[0].note === 'Cancelled by Mawahib') expect(staffRows).toBe(1);
    else expect(staffRows).toBe(0);
    const attempts = await prisma.payment.findMany({ where: { engagementId: row.engagementId } });
    expect(attempts.every((item) => item.status === 'cancelled' && item.failureCode === 'cancelled_before_start')).toBe(true);
  });

  it('finishes cleanly against payment creation, claiming, and settlement', async () => {
    const created = await seed();
    await Promise.allSettled([
      cancel(created),
      payments.create({
        id: crypto.randomUUID(),
        engagementId: created.engagementId,
        payerUserId: created.clientId,
        payeeUserId: created.providerId,
        amount: '25.00',
        currency: 'SAR',
        method: 'card',
        provider: 'mock',
        idempotencyKey: crypto.randomUUID(),
        mockMethodToken: 'mock_visa_success',
      }),
    ]);
    const createdEngagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: created.engagementId } });
    const createdPayments = await prisma.payment.findMany({ where: { engagementId: created.engagementId } });
    if (createdEngagement.status === 'cancelled') {
      expect(createdEngagement.staffClosedAt).toBeNull();
      expect(createdPayments.every((item) => item.status !== 'processing' && item.status !== 'succeeded')).toBe(true);
    } else {
      expect(createdEngagement.status).toBe('pending_payment');
      expect(createdPayments.some((item) => item.status === 'processing' || item.status === 'succeeded')).toBe(true);
      expect(await prisma.staffUnpaidCancellation.count({ where: { engagementId: created.engagementId } })).toBe(0);
    }

    const claimed = await seed({ attempts: [{ status: 'processing' }] });
    await Promise.allSettled([
      cancel(claimed),
      payments.markProcessing(claimed.paymentIds[0], 'claim-ref'),
    ]);
    const claimedEngagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: claimed.engagementId } });
    const claimedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: claimed.paymentIds[0] } });
    expect(claimedEngagement.status).toBe('pending_payment');
    expect(claimedPayment.status).toBe('processing');
    expect(await prisma.staffUnpaidCancellation.count({ where: { engagementId: claimed.engagementId } })).toBe(0);

    const settled = await seed({ attempts: [{ status: 'processing' }] });
    await Promise.allSettled([
      cancel(settled),
      payments.markSucceeded({
        id: settled.paymentIds[0],
        engagementId: settled.engagementId,
        providerReference: 'settled-ref',
        actorId: settled.clientId,
      }),
    ]);
    const settledEngagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: settled.engagementId } });
    const settledPayment = await prisma.payment.findUniqueOrThrow({ where: { id: settled.paymentIds[0] } });
    expect(settledEngagement.status).toBe('in_progress');
    expect(settledEngagement.staffClosedAt).toBeNull();
    expect(settledPayment.status).toBe('succeeded');
    expect(await prisma.engagementEvent.count({
      where: { engagementId: settled.engagementId, note: 'Cancelled by Mawahib' },
    })).toBe(0);
  });

  it('does not let deletion confirmation cancel the work', async () => {
    const row = await seed();
    const deletion = prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status
        FROM work_engagements
        WHERE id = ${row.engagementId}::uuid
        ORDER BY id
        FOR UPDATE
      `;
      if (locked[0]?.status === 'pending_payment') {
        throw new Error('DELETION_BLOCKED');
      }
      return locked[0]?.status ?? 'missing';
    });
    const results = await Promise.allSettled([deletion, cancel(row)]);
    const engagement = await prisma.workEngagement.findUniqueOrThrow({ where: { id: row.engagementId } });
    expect(engagement.status).toBe('cancelled');
    expect(engagement.staffClosedAt).toBeNull();
    expect(await prisma.staffUnpaidCancellation.count({ where: { engagementId: row.engagementId } })).toBe(1);
    expect(await prisma.engagementEvent.count({
      where: { engagementId: row.engagementId, note: 'Cancelled by Mawahib' },
    })).toBe(1);
    const deletionResult = results[0];
    if (deletionResult.status === 'fulfilled') expect(deletionResult.value).toBe('cancelled');
    else expect(String(deletionResult.reason)).toContain('DELETION_BLOCKED');
  });

  it('rolls the action back when the audit or notification write fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_unpaid_staff_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action::text = 'staff_unpaid_work_cancelled' AND NEW.reason = 'force-audit-fail' THEN
          RAISE EXCEPTION 'audit failed';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS fail_unpaid_staff_audit ON staff_audit_events
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_unpaid_staff_audit
      BEFORE INSERT ON staff_audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_unpaid_staff_audit()
    `);
    const audited = await seed({ attempts: [{ status: 'pending' }] });
    await expect(cancel(audited, crypto.randomUUID(), 'force-audit-fail')).rejects.toThrow('audit failed');
    await expectUnchanged(audited.engagementId);
    const pending = await prisma.payment.findFirstOrThrow({ where: { engagementId: audited.engagementId } });
    expect(pending.status).toBe('pending');
    expect(pending.failureCode).toBeNull();

    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_unpaid_staff_audit ON staff_audit_events`);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_unpaid_staff_notice() RETURNS trigger AS $$
      BEGIN
        IF NEW.body LIKE 'Mawahib cancelled this unpaid work%' THEN
          RAISE EXCEPTION 'notice failed';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_unpaid_staff_notice ON notifications`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_unpaid_staff_notice
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION fail_unpaid_staff_notice()
    `);
    const notified = await seed();
    await expect(cancel(notified)).rejects.toThrow('notice failed');
    await expectUnchanged(notified.engagementId);
    expect(await prisma.notification.count({
      where: { recipientId: { in: [notified.clientId, notified.providerId] } },
    })).toBe(0);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_unpaid_staff_notice ON notifications`);
  });
});
