import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AdminReadService } from './admin-read.service';
import { riyadhGrowthWindow } from './growth-window';

const databaseUrl = process.env.STAFF_GROWTH_DATABASE_URL;
const now = new Date('2026-11-18T09:00:00.000Z');

describe('growth counts', () => {
  if (!databaseUrl) {
    it.skip('requires STAFF_GROWTH_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const admin = new AdminReadService(prisma as never);
  const week = riyadhGrowthWindow(now, 7);
  const month = riyadhGrowthWindow(now, 30);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function person(name: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE', deleted = false, createdAt = week.start) {
    const id = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `${id}@growth.test`,
        accountType: 'talent',
        displayName: name,
        username: `g${id.slice(0, 12)}`,
        accountStatus: status,
        deletedAt: deleted ? now : null,
        createdAt,
      },
    });
    return id;
  }

  async function job(posterId: string, status: 'open' | 'draft' | 'expired' | 'closed', createdAt: Date, extra?: { hidden?: boolean; deleted?: boolean }) {
    const id = crypto.randomUUID();
    await prisma.jobListing.create({
      data: {
        id,
        posterId,
        title: `Growth ${id.slice(0, 8)}`,
        location: 'Riyadh',
        employmentType: 'freelance',
        status,
        createdAt,
        staffHiddenAt: extra?.hidden ? now : null,
        deletedAt: extra?.deleted ? now : null,
      },
    });
    return id;
  }

  it('counts retained qualifying rows and keeps the Riyadh window', async () => {
    const active = await person('Active');
    await person('Suspended', 'SUSPENDED');
    const removed = await person('Removed', 'ACTIVE', true);
    await person('Older', 'ACTIVE', false, new Date(week.start.getTime() - 1));
    await person('Boundary', 'ACTIVE', false, now);
    await person('After', 'ACTIVE', false, new Date(now.getTime() + 1));
    const suspendedOwner = await person('Hidden owner', 'SUSPENDED');

    const publicJob = await job(active, 'open', week.start);
    await job(active, 'expired', week.start);
    await job(active, 'draft', week.start);
    await job(active, 'closed', week.start);
    await job(active, 'open', week.start, { hidden: true });
    await job(active, 'open', week.start, { deleted: true });
    await job(suspendedOwner, 'open', week.start);
    await job(removed, 'open', week.start);
    await job(active, 'open', month.start);
    await job(active, 'open', new Date(week.start.getTime() - 1));

    await prisma.serviceOffering.create({
      data: { userId: active, title: 'Published', status: 'published', createdAt: week.start },
    });
    await prisma.serviceOffering.create({
      data: { userId: active, title: 'Archived', status: 'archived', createdAt: week.start },
    });
    await prisma.serviceOffering.create({
      data: { userId: active, title: 'Draft service', status: 'draft', createdAt: week.start },
    });
    await prisma.serviceOffering.create({
      data: { userId: active, title: 'Hidden service', status: 'published', staffHiddenAt: now, createdAt: week.start },
    });
    await prisma.serviceOffering.create({
      data: { userId: active, title: 'Deleted service', status: 'published', deletedAt: now, createdAt: week.start },
    });
    await prisma.serviceOffering.create({
      data: { userId: suspendedOwner, title: 'Suspended owner', status: 'published', createdAt: week.start },
    });

    await prisma.post.create({ data: { authorId: active, visibility: 'public', createdAt: week.start } });
    await prisma.post.create({ data: { authorId: active, visibility: 'connections', createdAt: week.start } });
    await prisma.post.create({ data: { authorId: active, visibility: 'public', staffHiddenAt: now, createdAt: week.start } });
    await prisma.post.create({ data: { authorId: active, visibility: 'public', deletedAt: now, createdAt: week.start } });
    await prisma.post.create({ data: { authorId: suspendedOwner, visibility: 'public', createdAt: week.start } });

    const provider = await person('Provider');
    await prisma.workEngagement.create({
      data: { clientId: active, providerId: provider, title: 'Kept', status: 'cancelled', source: 'direct', createdAt: week.start },
    });
    await prisma.workEngagement.create({
      data: { clientId: active, providerId: provider, title: 'Older work', status: 'completed', source: 'direct', createdAt: new Date(week.start.getTime() - 1) },
    });
    await prisma.workEngagement.create({
      data: { clientId: active, providerId: provider, title: 'Gone', status: 'cancelled', source: 'direct', deletedAt: now, createdAt: week.start },
    });

    const snapshot = await admin.growthSnapshot(7, now);
    expect(snapshot.timeZone).toBe('Asia/Riyadh');
    expect(snapshot.periodStart).toBe(week.start.toISOString());
    expect(snapshot.periodEnd).toBe(now.toISOString());
    expect(snapshot.current).toEqual({
      accounts: 7,
      publicJobs: 3,
      publicServices: 1,
      publicPosts: 1,
      staffHiddenJobs: 1,
      staffHiddenServices: 1,
      engagements: 2,
    });
    expect(snapshot.createdInPeriod).toEqual({
      accounts: 5,
      publicJobs: 1,
      publicServices: 1,
      publicPosts: 1,
      engagements: 1,
    });
    expect(snapshot.current.publicJobs).not.toBe(await prisma.jobListing.count({ where: { deletedAt: null } }));
    expect(snapshot.current.accounts).toBe(await prisma.user.count({ where: { deletedAt: null } }));
    expect(snapshot.current.engagements).toBe(await prisma.workEngagement.count({ where: { deletedAt: null } }));

    const wider = await admin.growthSnapshot(30, now);
    expect(wider.current).toEqual(snapshot.current);
    expect(wider.createdInPeriod.publicJobs).toBe(3);
    expect(wider.createdInPeriod.accounts).toBe(snapshot.createdInPeriod.accounts + 1);

    await prisma.jobListing.update({ where: { id: publicJob }, data: { staffHiddenAt: now } });
    const hidden = await admin.growthSnapshot(7, now);
    expect(hidden.current.publicJobs).toBe(2);
    expect(hidden.current.staffHiddenJobs).toBe(2);
    await prisma.jobListing.update({ where: { id: publicJob }, data: { staffHiddenAt: null } });
    const restored = await admin.growthSnapshot(7, now);
    expect(restored.current.publicJobs).toBe(3);
    expect(restored.current.staffHiddenJobs).toBe(1);

    await expect(admin.growthSnapshot('14', now)).rejects.toBeInstanceOf(BadRequestException);
  });
});
