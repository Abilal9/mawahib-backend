import { PrismaClient } from '@prisma/client';
import { AdminReadService } from './admin-read.service';

const databaseUrl = process.env.STAFF_PAYMENTS_DATABASE_URL;

describe('staff payment and follow-up lists', () => {
  if (!databaseUrl) {
    it.skip('requires STAFF_PAYMENTS_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const admin = new AdminReadService(prisma as never);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function user(name: string, deleted = false) {
    const id = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `${id}@payments.test`,
        accountType: 'talent',
        displayName: name,
        username: `u${id.slice(0, 12)}`,
        deletedAt: deleted ? new Date('2026-11-01T00:00:00.000Z') : null,
      },
    });
    return id;
  }

  it('returns every attempt, including retained history for deleted records', async () => {
    const payer = await user('Payer');
    const deletedPayer = await user('Old personal name', true);
    const payee = await user('Payee');
    const liveId = crypto.randomUUID();
    const deletedEngagementId = crypto.randomUUID();
    const sameTime = new Date('2026-11-18T00:00:00.000Z');
    await prisma.workEngagement.create({
      data: {
        id: liveId,
        clientId: payer,
        providerId: payee,
        title: 'Visible retained work',
        status: 'pending_payment',
        source: 'direct',
      },
    });
    await prisma.workEngagement.create({
      data: {
        id: deletedEngagementId,
        clientId: deletedPayer,
        providerId: payee,
        title: 'Deleted engagement work',
        status: 'completed',
        source: 'direct',
        deletedAt: new Date('2026-11-02T00:00:00.000Z'),
      },
    });
    const earlier = await prisma.payment.create({
      data: {
        engagementId: liveId,
        payerUserId: payer,
        payeeUserId: payee,
        amount: '30.00',
        currency: 'SAR',
        method: 'card',
        provider: 'mock',
        status: 'succeeded',
        providerReference: 'secret-provider-reference',
        idempotencyKey: crypto.randomUUID(),
        settlementKey: `${liveId}-paid`,
        succeededAt: new Date('2026-11-17T00:00:00.000Z'),
        createdAt: sameTime,
      },
    });
    await prisma.invoice.create({
      data: {
        engagementId: liveId,
        paymentId: earlier.id,
        invoiceNumber: `MWH-PAY-${earlier.id.slice(0, 8)}`,
        provider: 'mock',
        status: 'generated',
        currency: 'SAR',
        subtotal: '30.00',
        taxAmount: '0.00',
        total: '30.00',
        payerDisplayName: 'Historical Payer',
        payeeDisplayName: 'Historical Payee',
        description: 'Visible retained work',
        issuedAt: new Date('2026-11-17T01:00:00.000Z'),
      },
    });
    const later = await prisma.payment.create({
      data: {
        engagementId: liveId,
        payerUserId: payer,
        payeeUserId: payee,
        amount: '15.00',
        currency: 'AED',
        method: 'card',
        provider: 'mock',
        status: 'failed',
        failureCode: 'later_failure',
        idempotencyKey: crypto.randomUUID(),
        failedAt: sameTime,
        createdAt: sameTime,
      },
    });
    const sameTimeSibling = await prisma.payment.create({
      data: {
        engagementId: deletedEngagementId,
        payerUserId: deletedPayer,
        payeeUserId: payee,
        amount: '15.00',
        currency: 'AED',
        method: 'card',
        provider: 'mock',
        status: 'cancelled',
        idempotencyKey: crypto.randomUUID(),
        createdAt: sameTime,
      },
    });

    const page = await admin.listPayments({ q: 'Visible retained work', limit: '1' });
    expect(page.totalAttempts).toBeGreaterThanOrEqual(3);
    expect(page.matchCount).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const second = await admin.listPayments({ q: 'Visible retained work', limit: '1', cursor: page.nextCursor! });
    const ids = [page.items[0].id, second.items[0].id].sort();
    expect(ids).toEqual([earlier.id, later.id].sort());
    const encoded = JSON.stringify([page, second]);
    expect(encoded).not.toContain('secret-provider-reference');
    expect(encoded).not.toContain('providerReference');
    expect(encoded).not.toContain('Historical Payer');
    expect(encoded).not.toContain('https://');
    const succeeded = [...page.items, ...second.items].find((item) => item.id === earlier.id);
    expect(succeeded?.status).toBe('succeeded');
    expect(succeeded?.invoice?.invoiceNumber).toContain('MWH-PAY-');
    expect(succeeded?.referencedByProvider).toBe(true);

    const retained = await admin.listPayments({ q: deletedPayer });
    expect(retained.items.map((item) => item.id)).toContain(sameTimeSibling.id);
    expect(retained.items[0].payer?.displayName).toBe('Deleted user');
    expect(JSON.stringify(retained)).not.toContain('Old personal name');
    expect(retained.items[0].payer?.deleted).toBe(true);
    expect(retained.items[0].engagement.deleted).toBe(true);
    const hidden = await admin.listPayments({ q: deletedPayer, hideDeletedEngagements: 'true' });
    expect(hidden.matchCount).toBe(0);

    const before = await prisma.payment.count();
    await admin.listPayments({});
    expect(await prisma.payment.count()).toBe(before);
  });

  it('pages required follow-up independently from payment attempts', async () => {
    const client = await user('Client');
    const provider = await user('Provider');
    const staff = await prisma.staffMember.create({
      data: { issuer: 'https://staff.example/auth/v1', subjectId: crypto.randomUUID(), status: 'active', invitedEmail: 'staff@example.com' },
    });
    const createdAt = new Date('2026-11-18T03:00:00.000Z');
    const ids: string[] = [];
    for (const [index, outcome] of [['outstanding', null], ['recorded', 'no_real_funds']] as const) {
      const engagementId = crypto.randomUUID();
      ids.push(engagementId);
      await prisma.workEngagement.create({
        data: {
          id: engagementId,
          clientId: client,
          providerId: provider,
          title: `Follow ${index}`,
          status: 'cancelled',
          source: 'direct',
          staffClosedAt: createdAt,
        },
      });
      await prisma.engagementStaffClosure.create({
        data: {
          engagementId,
          via: 'engagement',
          fromStatus: 'in_progress',
          closedByStaffMemberId: staff.id,
          closedAt: createdAt,
          initiationCategory: 'staff_observation',
          idempotencyKey: crypto.randomUUID(),
          requestHash: 'a'.repeat(64),
          followUpRequired: true,
          followUpOutcome: outcome,
          followUpNote: outcome ? 'Plain staff note' : null,
          followUpRecordedAt: outcome ? createdAt : null,
          followUpRecordedByStaffMemberId: outcome ? staff.id : null,
          createdAt,
        },
      });
    }
    await prisma.engagementStaffClosure.create({
      data: {
        engagementId: (await prisma.workEngagement.create({
          data: {
            id: crypto.randomUUID(),
            clientId: client,
            providerId: provider,
            title: 'Not required',
            status: 'cancelled',
            source: 'direct',
            staffClosedAt: createdAt,
          },
        })).id,
        via: 'engagement',
        fromStatus: 'in_progress',
        closedByStaffMemberId: staff.id,
        closedAt: createdAt,
        initiationCategory: 'staff_observation',
        idempotencyKey: crypto.randomUUID(),
        requestHash: 'b'.repeat(64),
        followUpRequired: false,
        createdAt,
      },
    });

    const outstanding = await admin.listFinancialFollowUps({ followState: 'outstanding', limit: '1' });
    expect(outstanding.items.every((item) => item.state === 'outstanding')).toBe(true);
    expect(outstanding.items.every((item) => item.note == null)).toBe(true);
    expect(outstanding.totalRecords).toBeGreaterThanOrEqual(2);
    const recorded = await admin.listFinancialFollowUps({ followState: 'recorded' });
    expect(recorded.items.some((item) => item.note === 'Plain staff note' && item.outcome === 'no_real_funds')).toBe(true);
    expect(recorded.items.some((item) => item.engagement.title === 'Not required')).toBe(false);
    const first = await admin.listFinancialFollowUps({ limit: '1' });
    const next = await admin.listFinancialFollowUps({ limit: '1', cursor: first.nextCursor! });
    expect([first.items[0].engagement.id, next.items[0].engagement.id].sort()).toEqual([...ids].sort());
  });
});
