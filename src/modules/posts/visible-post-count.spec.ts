import { PostVisibility } from '@prisma/client';
import { countVisiblePosts, visiblePostsWhere } from './visible-post-count';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const VIEWER = '22222222-2222-4222-8222-222222222222';

describe('visible post counts', () => {
  it('includes an author’s hidden posts and excludes deleted posts', () => {
    const where = visiblePostsWhere({ authorIds: [AUTHOR], viewerId: AUTHOR, peerIds: [] });
    expect(where.deletedAt).toBeNull();
    expect(where.staffHiddenAt).toBeUndefined();
    expect(JSON.stringify(where)).toContain(AUTHOR);
  });

  it('hides staff-hidden posts from another viewer and keeps only public posts', () => {
    const where = visiblePostsWhere({ authorIds: [AUTHOR], viewerId: VIEWER, peerIds: [] });
    expect(where).toMatchObject({
      deletedAt: null,
      AND: [
        { OR: [{ staffHiddenAt: null }, { authorId: VIEWER }] },
        { OR: [{ visibility: PostVisibility.public }] },
      ],
    });
  });

  it('counts a connected viewer’s visible posts in one grouped query', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ authorId: AUTHOR, _count: { _all: 2 } }]);
    const counts = await countVisiblePosts(
      { post: { groupBy }, connection: { findMany: jest.fn() } },
      [AUTHOR],
      VIEWER,
      [AUTHOR],
    );
    expect(counts.get(AUTHOR)).toBe(2);
    expect(groupBy).toHaveBeenCalledTimes(1);
    const where = groupBy.mock.calls[0][0].where as { AND: unknown[] };
    expect(JSON.stringify(where)).toContain('connections');
    expect(JSON.stringify(where)).toContain('staffHiddenAt');
  });

  it('gives a guest no count for a hidden-only author', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const counts = await countVisiblePosts(
      { post: { groupBy }, connection: { findMany: jest.fn() } },
      [AUTHOR],
      null,
      [],
    );
    expect(counts.get(AUTHOR)).toBeUndefined();
    const where = groupBy.mock.calls[0][0].where as { deletedAt: null; AND: Array<{ staffHiddenAt?: null }> };
    expect(where.deletedAt).toBeNull();
    expect(where.AND[0]).toEqual({ staffHiddenAt: null });
  });
});
