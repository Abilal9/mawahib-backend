import { JobListingStatus } from '@prisma/client';
import { PrismaMarketplaceRepository } from './repositories/prisma-marketplace.repository';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

describe('job listing taxonomy filters', () => {
  const categoryId = uuid(4);
  const skillA = uuid(5);
  const skillB = uuid(6);
  const prisma = {
    jobListing: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    $queryRaw: jest.fn(async () => []),
  };
  const repo = new PrismaMarketplaceRepository(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ORs canonical skills into text search and ANDs the category before paging', async () => {
    await repo.listListings({
      status: JobListingStatus.open,
      q: 'logo',
      filterCategoryIds: [categoryId],
      searchSkillIds: [skillA, skillB],
      skip: 20,
      take: 5,
    });
    expect(prisma.jobListing.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.jobListing.findMany.mock.calls[0][0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(5);
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.status).toEqual({ in: [JobListingStatus.open] });
    expect(args.where.AND).toEqual([{ categoryId: { in: [categoryId] } }]);
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.anything() }),
        expect.objectContaining({ exploreTag: expect.anything() }),
        { taxonomySkills: { some: { skillId: { in: [skillA, skillB] } } } },
      ]),
    );
    expect(JSON.stringify(args.where.AND)).not.toContain(skillA);
    expect(args.orderBy).toEqual([
      { postedAt: 'desc' },
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('does not turn resolved skill ids into a filter when there is no query', async () => {
    await repo.listListings({
      status: JobListingStatus.open,
      searchSkillIds: [skillA],
      skip: 0,
      take: 20,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const args = prisma.jobListing.findMany.mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
    expect(args.where.AND).toBeUndefined();
    expect(args.where).toEqual({
      deletedAt: null,
      status: { in: [JobListingStatus.open] },
    });
  });

  it('keeps the unfiltered open listing query free of taxonomy predicates', async () => {
    await repo.listListings({
      status: JobListingStatus.open,
      skip: 0,
      take: 20,
    });
    const args = prisma.jobListing.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      status: { in: [JobListingStatus.open] },
    });
    expect(args.orderBy).toEqual([
      { postedAt: 'desc' },
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('counts with the same search and category predicates', async () => {
    const filter = {
      status: JobListingStatus.open,
      q: 'figma',
      filterCategoryIds: [categoryId],
      searchSkillIds: [skillA],
      skip: 0,
      take: 20,
    };
    await repo.listListings(filter);
    await repo.countListings(filter);
    const listed = prisma.jobListing.findMany.mock.calls[0][0].where;
    const counted = prisma.jobListing.count.mock.calls[0][0].where;
    expect(counted).toEqual(listed);
    expect(counted.AND).toEqual([{ categoryId: { in: [categoryId] } }]);
    expect(counted.OR).toEqual(
      expect.arrayContaining([
        { taxonomySkills: { some: { skillId: { in: [skillA] } } } },
      ]),
    );
  });
});
