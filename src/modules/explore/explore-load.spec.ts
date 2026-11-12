import { PrismaExploreRepository } from './repositories/prisma-explore.repository';

describe('explore service hydration', () => {
  it('drops a service whose owner is no longer publicly eligible', async () => {
    const findMany = jest.fn(async () => []);
    const repo = new PrismaExploreRepository({ serviceOffering: { findMany } } as never);

    await repo.loadServices(['svc-1']);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ['svc-1'] },
        deletedAt: null,
        staffHiddenAt: null,
        status: 'published',
        user: { deletedAt: null, accountStatus: 'ACTIVE' },
      },
    }));
  });
});
