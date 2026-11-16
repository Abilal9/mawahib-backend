import { PrismaClient } from '@prisma/client';
import { DeletionEligibilityService } from './deletion-eligibility.service';
import { DeletionRequestService } from './deletion-request.service';
import { refuseNewObligation } from './deletion-obligation';

const databaseUrl = process.env.DELETION_REQUEST_DATABASE_URL;

describe('deletion request transaction', () => {
  if (!databaseUrl) {
    it.skip('requires DELETION_REQUEST_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const requests = new DeletionRequestService(prisma as never, new DeletionEligibilityService(prisma as never));

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function user() {
    const id = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `${id}@deletion.test`,
        accountType: 'talent',
        displayName: 'Synthetic',
        username: `u${id.replaceAll('-', '').slice(0, 20)}`,
      },
    });
    return id;
  }

  it('keeps one pending request when two creates race, and preserves a staff origin', async () => {
    const id = await user();
    const issuedAt = Date.now() / 1000;
    const [first, second] = await Promise.allSettled([
      requests.requestSelf(id, 'key-a', issuedAt),
      requests.requestSelf(id, 'key-b', issuedAt),
    ]);
    expect(first.status === 'fulfilled' || second.status === 'fulfilled').toBe(true);
    expect(await prisma.accountDeletionRequest.count({ where: { userId: id, status: 'pending' } })).toBe(1);
    const staffId = crypto.randomUUID();
    await prisma.staffMember.create({ data: { id: staffId, issuer: 'https://staff.example', subjectId: crypto.randomUUID(), status: 'active' } });
    await prisma.accountDeletionRequest.updateMany({
      where: { userId: id, status: 'pending' },
      data: { staffRequestedAt: new Date(), staffMemberId: staffId, staffReason: 'Terms review' },
    });
    const cancelled = await requests.cancelSelf(id);
    expect(cancelled.selfOrigin).toBe(false);
    expect(cancelled.staffOrigin).toBe(true);
    expect(cancelled.restrictionsActive).toBe(true);
    await expect(prisma.$transaction((tx) => refuseNewObligation(tx, [id]))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DELETION_REQUEST_PENDING' }) as object,
    });
  });
});
