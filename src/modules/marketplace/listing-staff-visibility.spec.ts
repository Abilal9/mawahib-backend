import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobListingStatus, Prisma, ServiceOfferingStatus } from '@prisma/client';
import { PrismaMarketplaceRepository } from './repositories/prisma-marketplace.repository';
import { canReadListing } from './listing-visibility';
import { canSaveJob, savedJobWhere } from './saved-job.query';
import { canSaveService, savedServiceWhere } from '../services/saved-service.query';
import { publicServiceWhere } from '../public/public-explore-sql';

const hiddenAt = new Date('2026-11-12T00:00:00.000Z');

function flatten(node: Prisma.Sql): string {
  return node.strings.map((part, index) => {
    const value = node.values[index];
    if (value && typeof value === 'object' && 'strings' in value && 'values' in value) {
      return part + flatten(value as Prisma.Sql);
    }
    return part;
  }).join(' ');
}

describe('listing staff visibility', () => {
  const base = {
    status: JobListingStatus.open,
    posterId: 'owner',
    viewerId: 'stranger',
    viewerHasApplication: false,
  };

  it('keeps a hidden job available to the owner and an existing applicant only', () => {
    expect(canReadListing({ ...base, staffHiddenAt: hiddenAt })).toBe(false);
    expect(canReadListing({ ...base, viewerId: 'owner', staffHiddenAt: hiddenAt })).toBe(true);
    expect(canReadListing({ ...base, viewerHasApplication: true, staffHiddenAt: hiddenAt })).toBe(true);
    expect(canReadListing({ ...base, status: JobListingStatus.archived, viewerId: 'stranger' })).toBe(false);
    expect(canReadListing({ ...base, status: JobListingStatus.expired, viewerHasApplication: true })).toBe(true);
  });

  it('blocks new saves while a restriction applies and keeps the saved row filter', () => {
    const save = {
      status: JobListingStatus.open,
      deletedAt: null,
      posterDeletedAt: null,
      posterId: 'owner',
      viewerId: 'viewer',
      hasLiveApplication: false,
    };
    expect(canSaveJob({ ...save, staffHiddenAt: hiddenAt })).toBe(false);
    expect(canSaveJob(save)).toBe(true);
    expect(savedJobWhere('viewer', null).job).toEqual(expect.objectContaining({ staffHiddenAt: null }));
    expect(canSaveService({
      status: ServiceOfferingStatus.published,
      deletedAt: null,
      ownerDeletedAt: null,
      staffHiddenAt: hiddenAt,
    })).toBe(false);
    expect(savedServiceWhere('viewer', null).service).toEqual(expect.objectContaining({ staffHiddenAt: null }));
  });

  it('requires a public service to be unhidden, published, and owned by an eligible account', () => {
    const sql = flatten(publicServiceWhere({}));
    expect(sql).toContain('so.staff_hidden_at IS NULL');
    expect(sql).toContain('published');
    expect(sql).toContain('account_status');
    expect(sql).toContain('deleted_at IS NULL');
  });
});

describe('listing acquisition locks', () => {
  function repository(open: boolean) {
    const queries: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        queries.push(strings.join(' '));
        return open ? [{ id: 'listing' }] : [];
      }),
      jobApplication: { create: jest.fn() },
      workRequest: { create: jest.fn(async () => ({ id: 'request' })) },
    };
    const prisma = {
      $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { repo: new PrismaMarketplaceRepository(prisma as never), queries, tx };
  }

  it('does not create an application when the job is hidden or no longer open', async () => {
    const { repo, queries, tx } = repository(false);
    await expect(repo.createApplicationWithWorkRequest({
      listingId: '11111111-1111-4111-8111-111111111111',
      applicantId: '22222222-2222-4222-8222-222222222222',
      posterId: '33333333-3333-4333-8333-333333333333',
      coverLetter: 'Hello',
      title: 'Role',
      terms: {} as never,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(queries[0]).toContain('staff_hidden_at IS NULL');
    expect(queries[0]).toContain('account_status');
    expect(queries[0]).toContain('FOR UPDATE');
    expect(tx.jobApplication.create).not.toHaveBeenCalled();
  });

  it('does not create a service request when the offering is hidden', async () => {
    const { repo, queries, tx } = repository(false);
    await expect(repo.createWorkRequest({
      source: 'service' as never,
      senderUserId: '22222222-2222-4222-8222-222222222222',
      recipientUserId: '33333333-3333-4333-8333-333333333333',
      clientUserId: '22222222-2222-4222-8222-222222222222',
      providerUserId: '33333333-3333-4333-8333-333333333333',
      serviceOfferingId: '11111111-1111-4111-8111-111111111111',
      title: 'Service',
      terms: {} as never,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(queries[0]).toContain('staff_hidden_at IS NULL');
    expect(queries[0]).toContain('account_status');
    expect(queries[0]).toContain('FOR UPDATE');
    expect(tx.workRequest.create).not.toHaveBeenCalled();
  });
});
