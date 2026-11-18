import { paymentListQuery, paymentWhere, followUpListQuery, followUpWhere } from './admin-read.query';
import { toFollowUpRecord, toPaymentLedger } from './admin-read.mapper';

describe('payment list filters', () => {
  it('combines status and invoice state, and keeps every matching attempt', () => {
    const where = paymentWhere(paymentListQuery({
      status: 'succeeded,failed',
      invoiceState: 'none,pending',
    }));
    expect(where.status).toEqual({ in: ['succeeded', 'failed'] });
    expect(where.AND).toEqual([{
      OR: [
        { invoice: { is: null } },
        { invoice: { is: { status: { in: ['pending'] } } } },
      ],
    }]);
    expect(where.engagement).toBeUndefined();
  });

  it('can hide deleted engagements without being the default', () => {
    expect(paymentWhere(paymentListQuery({})).engagement).toBeUndefined();
    expect(paymentWhere(paymentListQuery({ hideDeletedEngagements: 'true' })).engagement).toEqual({
      is: { deletedAt: null },
    });
  });

  it('searches titles, participant names, invoice numbers, and record ids', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const where = paymentWhere(paymentListQuery({ q: id }));
    expect(where.OR).toEqual(expect.arrayContaining([
      { id },
      { engagementId: id },
      { payerUserId: id },
      { payeeUserId: id },
      { invoice: { is: { invoiceNumber: expect.objectContaining({ contains: id }) } } },
    ]));
    expect(JSON.stringify(where)).not.toContain('payerDisplayName');
  });
});

describe('follow-up list filters', () => {
  it('keeps required follow-up and does not treat not-required as outstanding', () => {
    expect(followUpWhere(followUpListQuery({}))).toEqual({ followUpRequired: true });
    expect(followUpWhere(followUpListQuery({ followState: 'outstanding' }))).toEqual({
      followUpRequired: true,
      followUpOutcome: null,
    });
    expect(followUpWhere(followUpListQuery({ followState: 'recorded' }))).toEqual({
      followUpRequired: true,
      followUpOutcome: { not: null },
    });
    expect(followUpWhere(followUpListQuery({ followState: 'outstanding,recorded' }))).toEqual({
      followUpRequired: true,
    });
  });
});

describe('payment ledger mapping', () => {
  const engagement = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Retained work',
    status: 'cancelled',
    deletedAt: new Date('2026-11-01T00:00:00.000Z'),
    staffClosedAt: null,
    staffUnpaidCancellation: { id: 'closure' },
  };

  it('returns both attempts and omits provider, storage, and snapshot identity fields', () => {
    const secret = 'provider-reference-secret';
    const item = toPaymentLedger({
      id: '33333333-3333-4333-8333-333333333333',
      amount: '40.00',
      currency: 'SAR',
      status: 'succeeded',
      provider: 'mock',
      providerReference: secret,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      succeededAt: new Date('2026-11-01T01:00:00.000Z'),
      failedAt: null,
      payer: { id: 'payer', displayName: 'Ada Personal', deletedAt: new Date() },
      payee: { id: 'payee', displayName: 'Payee', deletedAt: null },
      engagement,
      invoice: {
        id: 'invoice',
        invoiceNumber: 'MWH-2026-000010',
        status: 'generated',
        currency: 'SAR',
        total: '40.00',
        provider: 'mock',
        issuedAt: new Date('2026-11-01T02:00:00.000Z'),
        documentMediaAssetId: 'asset-secret',
        payerDisplayName: 'Historical Payer',
        payeeDisplayName: 'Historical Payee',
        description: 'Retained work',
      },
    });
    const encoded = JSON.stringify(item);
    expect(item.payer?.displayName).toBe('Deleted user');
    expect(encoded).not.toContain('Ada Personal');
    expect(item.referencedByProvider).toBe(true);
    expect(item.engagement.cancelledByMawahib).toBe(true);
    expect(item.engagement.deleted).toBe(true);
    expect(item.invoice?.hasDocument).toBe(true);
    expect(item.invoice?.retryable).toBe(false);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain('providerReference');
    expect(encoded).not.toContain('asset-secret');
    expect(encoded).not.toContain('Historical Payer');
    expect(encoded).not.toContain('http');
  });

  it('offers retry only for an open invoice with saved names', () => {
    const item = toPaymentLedger({
      id: '44444444-4444-4444-8444-444444444444',
      amount: '10.00',
      currency: 'SAR',
      status: 'succeeded',
      provider: 'mock',
      providerReference: null,
      createdAt: new Date('2026-11-02T00:00:00.000Z'),
      succeededAt: new Date('2026-11-02T01:00:00.000Z'),
      failedAt: null,
      payer: null,
      payee: null,
      engagement: { ...engagement, deletedAt: null, staffUnpaidCancellation: null },
      invoice: {
        id: 'invoice-2',
        invoiceNumber: 'MWH-2026-000011',
        status: 'failed',
        currency: 'SAR',
        total: '10.00',
        provider: 'mock',
        issuedAt: null,
        documentMediaAssetId: null,
        payerDisplayName: 'Payer',
        payeeDisplayName: 'Payee',
        description: 'Work',
      },
    });
    expect(item.invoice?.retryable).toBe(true);
    expect(item.invoice?.hasDocument).toBe(false);
    expect(item.referencedByProvider).toBe(false);
  });

  it('keeps an outstanding follow-up note off the record and shows a recorded note as text', () => {
    const outstanding = toFollowUpRecord({
      id: '55555555-5555-4555-8555-555555555555',
      followUpOutcome: null,
      followUpNote: '<b>hidden</b>',
      followUpRecordedAt: null,
      createdAt: new Date('2026-11-03T00:00:00.000Z'),
      followUpRecorder: null,
      engagement,
    });
    expect(outstanding.state).toBe('outstanding');
    expect(outstanding.note).toBeNull();
    const recorded = toFollowUpRecord({
      id: '66666666-6666-4666-8666-666666666666',
      followUpOutcome: 'no_real_funds',
      followUpNote: 'Staff note only',
      followUpRecordedAt: new Date('2026-11-03T01:00:00.000Z'),
      createdAt: new Date('2026-11-03T00:00:00.000Z'),
      followUpRecorder: { invitedEmail: 'staff@example.com' },
      engagement,
    });
    expect(recorded.state).toBe('recorded');
    expect(recorded.note).toBe('Staff note only');
    expect(recorded.outcome).toBe('no_real_funds');
  });
});
