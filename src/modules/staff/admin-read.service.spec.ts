import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentProviderKind, WorkEngagementStatus } from '@prisma/client';
import { selectDisputeEvent, selectPayment, toDispute, toPaymentSummary } from './admin-read.mapper';
import { decodeCursor, disputeEventQuery, disputePageWhere, encodeCursor, userPageWhere } from './admin-read.query';
import { AdminReadService } from './admin-read.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

function userRow(id: string, createdAt: string) {
  return {
    id,
    email: `${id.slice(0, 8)}@example.com`,
    username: `user-${id.slice(0, 4)}`,
    displayName: 'Ada Operatorview',
    accountType: 'talent',
    accountStatus: 'ACTIVE',
    createdAt: new Date(createdAt),
    deletedAt: null,
    followersCount: 2,
    followingCount: 3,
    postsCount: 4,
    _count: { engagementsAsClient: 1, engagementsAsProvider: 2 },
  };
}

describe('admin read queries', () => {
  it('matches email, username, and an id without a contains search', () => {
    expect(userPageWhere('ada@example.com', null)).toEqual({
      OR: [{ email: { equals: 'ada@example.com' } }, { username: { equals: 'ada@example.com' } }],
    });
    const byId = userPageWhere(USER_ID, null) as { OR: Array<{ id?: string }> };
    expect(byId.OR[0]).toEqual({ id: USER_ID });
    expect(JSON.stringify(userPageWhere('ada', null))).not.toContain('contains');
  });

  it('keeps the same lookup when moving to the next page', () => {
    const cursor = { at: '2026-01-01T00:00:00.000Z', id: USER_ID };
    const where = userPageWhere('Ada@Example.com', cursor) as {
      AND: [{ OR: unknown[] }, { OR: unknown[] }];
    };
    expect(where.AND[0]).toEqual({
      OR: [
        { email: { equals: 'Ada@Example.com' } },
        { username: { equals: 'Ada@Example.com' } },
      ],
    });
    expect(where.AND[1]).toEqual({
      OR: [
        { createdAt: { gt: new Date(cursor.at) } },
        { createdAt: new Date(cursor.at), id: { gt: USER_ID } },
      ],
    });
    const disputeWhere = disputePageWhere(cursor) as {
      AND: [{ status: string }, { OR: unknown[] }];
    };
    expect(disputeWhere.AND[0]).toEqual({ status: WorkEngagementStatus.disputed });
    expect(disputeWhere.AND[1]).toEqual({
      OR: [
        { updatedAt: { lt: new Date(cursor.at) } },
        { updatedAt: new Date(cursor.at), id: { lt: USER_ID } },
      ],
    });
  });

  it('lists only disputed engagements, newest first, and reads the dispute event', () => {
    expect(disputePageWhere(null)).toEqual({ status: WorkEngagementStatus.disputed });
    expect(disputeEventQuery.where).toEqual({ toStatus: WorkEngagementStatus.disputed });
    expect(disputeEventQuery.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(disputeEventQuery.take).toBe(1);
    expect(disputeEventQuery.select).toEqual({
      id: true,
      note: true,
      createdAt: true,
      toStatus: true,
    });
  });

  it('rejects an unusable cursor', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
    const encoded = encodeCursor({ at: '2026-01-01T00:00:00.000Z', id: USER_ID });
    expect(decodeCursor(encoded)).toEqual({ at: '2026-01-01T00:00:00.000Z', id: USER_ID });
  });
});

describe('dispute selection', () => {
  const earlier = new Date('2026-01-01T00:00:00.000Z');
  const later = new Date('2026-02-01T00:00:00.000Z');

  it('uses the latest dispute event and ignores an earlier note', () => {
    const selected = selectDisputeEvent([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: 'earlier dispute', createdAt: earlier, toStatus: 'disputed' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', note: 'delivery note', createdAt: later, toStatus: 'delivered' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', note: 'current dispute', createdAt: later, toStatus: 'disputed' },
    ]);
    expect(selected?.note).toBe('current dispute');
  });

  it('returns no note when the dispute event is missing', () => {
    expect(selectDisputeEvent([])).toBeNull();
    const dispute = toDispute({
      id: OTHER_ID,
      title: 'Poster design',
      updatedAt: later,
      deletedAt: earlier,
      client: null,
      provider: { displayName: 'Nour' },
      events: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', note: 'not a dispute', createdAt: later, toStatus: 'delivered' }],
      payments: [],
    });
    expect(dispute.disputeNote).toBeNull();
    expect(dispute.clientDisplayName).toBeNull();
    expect(dispute.providerDisplayName).toBe('Nour');
    expect(dispute.deletedAt).toBe(earlier.toISOString());
    expect(dispute.payment).toBeNull();
  });

  it('shows a newer failed attempt as failed instead of an earlier success', () => {
    const summary = toPaymentSummary(
      selectPayment([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          amount: { toFixed: (digits: number) => (digits === 2 ? '80.00' : '80') },
          currency: 'SAR',
          status: 'succeeded',
          provider: PaymentProviderKind.mock,
          createdAt: earlier,
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          amount: { toFixed: (digits: number) => (digits === 2 ? '80.00' : '80') },
          currency: 'SAR',
          status: 'failed',
          provider: PaymentProviderKind.mock,
          createdAt: later,
        },
      ]),
    );
    expect(summary).toEqual({
      amount: '80.00',
      currency: 'SAR',
      status: 'failed',
      simulated: true,
    });
  });

  it('labels only the mock provider as simulated', () => {
    const latest = selectPayment([
      { id: '1', amount: '10.00', currency: 'SAR', status: 'failed', provider: PaymentProviderKind.mock, createdAt: earlier },
      { id: '2', amount: { toFixed: () => '25.50' }, currency: 'SAR', status: 'succeeded', provider: PaymentProviderKind.mock, createdAt: later },
    ]);
    expect(toPaymentSummary(latest)).toEqual({
      amount: '25.50',
      currency: 'SAR',
      status: 'succeeded',
      simulated: true,
    });
    expect(
      toPaymentSummary({ amount: '1.00', currency: 'SAR', status: 'pending', provider: 'other' })?.simulated,
    ).toBe(false);
  });
});

describe('AdminReadService', () => {
  const findManyUsers = jest.fn();
  const findUser = jest.fn();
  const countPayments = jest.fn();
  const findManyDisputes = jest.fn();
  const findDispute = jest.fn();
  const service = new AdminReadService({
    user: { findMany: findManyUsers, findUnique: findUser },
    payment: { count: countPayments },
    workEngagement: { findMany: findManyDisputes, findFirst: findDispute },
  } as never);

  beforeEach(() => {
    findManyUsers.mockReset();
    findUser.mockReset();
    countPayments.mockReset();
    findManyDisputes.mockReset();
    findDispute.mockReset();
  });

  it('bounds lookup and returns an empty page instead of failing', async () => {
    await expect(service.searchUsers({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.searchUsers({ q: 'x'.repeat(201) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.searchUsers({ q: 'ada', limit: 0 })).rejects.toBeInstanceOf(BadRequestException);
    findManyUsers.mockResolvedValue([]);
    await expect(service.searchUsers({ q: 'ada@example.com' })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    const args = findManyUsers.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(args.take).toBe(21);
    expect(args.select).not.toHaveProperty('profile');
    expect(args.select.email).toBe(true);
    expect(JSON.stringify(args.select)).not.toContain('bio');
  });

  it('returns the next user cursor and keeps email on the summary', async () => {
    findManyUsers.mockResolvedValue([
      userRow(USER_ID, '2026-01-01T00:00:00.000Z'),
      userRow(OTHER_ID, '2026-01-02T00:00:00.000Z'),
    ]);
    const page = await service.searchUsers({ q: 'ada', limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].email).toContain('@example.com');
    expect(page.items[0]).not.toHaveProperty('followersCount');
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('returns minimal account detail and a simulated payment count', async () => {
    findUser.mockResolvedValue(userRow(USER_ID, '2026-01-01T00:00:00.000Z'));
    countPayments.mockResolvedValue(2);
    const detail = await service.userDetail(USER_ID);
    expect(detail.displayName).toBe('Ada Operatorview');
    expect(detail.clientEngagementCount).toBe(1);
    expect(detail.simulatedPaymentCount).toBe(2);
    expect(detail).not.toHaveProperty('bio');
    expect(countPayments.mock.calls[0][0].where.provider).toBe('mock');
    findUser.mockResolvedValue(null);
    await expect(service.userDetail(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('asks only for disputed rows and does not request chats or invoices', async () => {
    findManyDisputes.mockResolvedValue([]);
    await service.listDisputes({});
    const args = findManyDisputes.mock.calls[0][0];
    expect(args.where).toEqual({ status: 'disputed' });
    expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    expect(args.select.events.where).toEqual({ toStatus: 'disputed' });
    expect(args.select).not.toHaveProperty('conversation');
    expect(args.select).not.toHaveProperty('invoices');
    expect(JSON.stringify(args.select.payments.select)).not.toContain('providerReference');
  });

  it('hides engagements that are not currently disputed', async () => {
    findDispute.mockResolvedValue(null);
    await expect(service.disputeDetail(OTHER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(findDispute.mock.calls[0][0].where).toEqual({ id: OTHER_ID, status: 'disputed' });
  });
});
