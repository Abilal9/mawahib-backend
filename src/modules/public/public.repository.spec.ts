import { AccountStatus, JobListingStatus, PostVisibility } from '@prisma/client';
import { PublicRepository } from './public.repository';
import { discoverableUserWhere } from './discoverable-user';

describe('PublicRepository predicates', () => {
  const prisma = {
    post: { findMany: jest.fn(), findFirst: jest.fn() },
    jobListing: { findMany: jest.fn(), findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    serviceOffering: { findMany: jest.fn(), findFirst: jest.fn() },
    portfolioProject: { findMany: jest.fn() },
    postLike: { groupBy: jest.fn() },
    postComment: { groupBy: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const repo = new PublicRepository(prisma as never);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.post.findMany.mockResolvedValue([]);
    prisma.post.findFirst.mockResolvedValue(null);
    prisma.jobListing.findMany.mockResolvedValue([]);
    prisma.jobListing.findFirst.mockResolvedValue(null);
    prisma.portfolioProject.findMany.mockResolvedValue([]);
  });

  it('hardcodes OPEN jobs and discoverable posters', async () => {
    await repo.listPublicOpenJobs({ take: 20, skip: 0, q: 'ab' });
    const arg = prisma.jobListing.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe(JobListingStatus.open);
    expect(arg.where.poster).toEqual(discoverableUserWhere);
    expect(arg.where).not.toHaveProperty('posterId');
    expect(Object.keys(arg.where)).not.toContain('applications');
  });

  it('looks up job detail with the same OPEN predicate', async () => {
    await repo.findPublicOpenJob('33333333-3333-4333-8333-333333333333');
    const arg = prisma.jobListing.findFirst.mock.calls[0][0];
    expect(arg.where.status).toBe(JobListingStatus.open);
    expect(arg.where.poster).toEqual({
      deletedAt: null,
      accountStatus: AccountStatus.ACTIVE,
    });
  });

  it('lists only PUBLIC posts by discoverable authors', async () => {
    await repo.listPublicFeed({ cursor: null, take: 21 });
    const arg = prisma.post.findMany.mock.calls[0][0];
    expect(arg.where.visibility).toBe(PostVisibility.public);
    expect(arg.where.author).toEqual(discoverableUserWhere);
    expect(arg.where.deletedAt).toBeNull();
  });

  it('hides connection-only posts at lookup', async () => {
    await repo.findPublicPost('22222222-2222-4222-8222-222222222222');
    const arg = prisma.post.findFirst.mock.calls[0][0];
    expect(arg.where.visibility).toBe(PostVisibility.public);
    expect(arg.where.visibility).not.toBe(PostVisibility.connections);
  });

  it('only includes purpose-matching ready media on public parents', async () => {
    await repo.listPublicUserPortfolio('11111111-1111-4111-8111-111111111111');
    const arg = prisma.portfolioProject.findMany.mock.calls[0][0];
    expect(arg.include.media.where.mediaAsset.purpose).toBe('portfolio');
    expect(arg.include.media.where.mediaAsset.status).toBe('ready');
    expect(arg.include.media.where.mediaAsset.deletedAt).toBeNull();
  });
});
