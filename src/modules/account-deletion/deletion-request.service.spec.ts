import { hasRecentAuthentication, RECENT_AUTH_WINDOW_MS } from './recent-auth';
import { DeletionRequestService } from './deletion-request.service';

describe('recent authentication', () => {
  const now = 1_700_000_000_000;

  it('accepts a token issued inside the window and rejects a missing or old time', () => {
    expect(hasRecentAuthentication(now / 1000, now)).toBe(true);
    expect(hasRecentAuthentication(undefined, now)).toBe(false);
    expect(hasRecentAuthentication((now - RECENT_AUTH_WINDOW_MS - 1000) / 1000, now)).toBe(false);
  });
});

describe('deletion request lifecycle', () => {
  function harness() {
    const row = {
      id: 'req-1',
      userId: 'user-1',
      status: 'pending' as 'pending' | 'withdrawn',
      selfRequestedAt: null as Date | null,
      selfIdempotencyKey: null as string | null,
      staffRequestedAt: null as Date | null,
      staffMemberId: null as string | null,
      staffReason: null as string | null,
    };
    const tx = {
      $queryRaw: jest.fn(),
      user: { findUnique: jest.fn(async () => ({ id: 'user-1', deletedAt: null })) },
      accountDeletionRequest: {
        findFirst: jest.fn(async () => (row.status === 'pending' && (row.selfRequestedAt || row.staffRequestedAt) ? row : null)),
        create: jest.fn(async ({ data }: { data: { selfRequestedAt: Date; selfIdempotencyKey: string } }) => {
          row.selfRequestedAt = data.selfRequestedAt;
          row.selfIdempotencyKey = data.selfIdempotencyKey;
          row.status = 'pending';
          return row;
        }),
        update: jest.fn(async ({ data }: { data: { status?: 'withdrawn'; selfRequestedAt: Date | null; closedAt?: Date } }) => {
          row.selfRequestedAt = data.selfRequestedAt;
          if (data.status) row.status = data.status;
          return row;
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
      accountDeletionRequest: { findFirst: jest.fn(async () => null) },
    };
    const eligibility = { evaluate: jest.fn(async () => ({ status: 'eligible', blockers: [] })) };
    return { service: new DeletionRequestService(prisma as never, eligibility as never), row, eligibility };
  }

  it('creates a self request and keeps a staff origin when the self origin is cancelled', async () => {
    const { service, row, eligibility } = harness();
    eligibility.evaluate.mockResolvedValue({ status: 'blocked', blockers: [] });
    await service.requestSelf('user-1', 'key-1', Date.now() / 1000);
    expect(row.selfRequestedAt).toBeInstanceOf(Date);
    row.staffRequestedAt = new Date();
    await service.cancelSelf('user-1');
    expect(row.selfRequestedAt).toBeNull();
    expect(row.status).toBe('pending');
    expect(row.staffRequestedAt).not.toBeNull();
  });

  it('removes restrictions when cancelling the only origin', async () => {
    const { service, row } = harness();
    await service.requestSelf('user-1', 'key-1', Date.now() / 1000);
    await service.cancelSelf('user-1');
    expect(row.status).toBe('withdrawn');
    expect(row.selfRequestedAt).toBeNull();
  });

  it('rejects a request without a recent sign-in', async () => {
    const { service } = harness();
    await expect(service.requestSelf('user-1', 'key-1', undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RECENT_AUTH_REQUIRED' }) as object,
    });
  });
});
