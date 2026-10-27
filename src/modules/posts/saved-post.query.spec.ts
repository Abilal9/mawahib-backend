import { PostVisibility } from '@prisma/client';
import { savedPostWhere } from './saved-post.query';

describe('savedPostWhere', () => {
  const where = savedPostWhere(
    'viewer',
    ['peer'],
    { createdAt: '2026-04-02T00:00:00.000Z', id: 'post-b' },
  );

  it('keeps visibility, deleted authors, and the keyset inside one query', () => {
    expect(where.userId).toBe('viewer');
    expect(where.post).toMatchObject({
      deletedAt: null,
      author: { deletedAt: null },
    });
    const post = where.post as {
      OR: Array<{ authorId?: string; visibility?: PostVisibility; authorId_in?: unknown }>;
    };
    expect(post.OR).toEqual([
      { authorId: 'viewer' },
      { visibility: PostVisibility.public },
      { visibility: PostVisibility.connections, authorId: { in: ['peer'] } },
    ]);
    expect(where.OR).toEqual([
      { createdAt: { lt: new Date('2026-04-02T00:00:00.000Z') } },
      {
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        postId: { lt: 'post-b' },
      },
    ]);
  });

  it('omits the connections branch when the viewer has no peers', () => {
    const open = savedPostWhere('viewer', [], null);
    const post = open.post as { OR: unknown[] };
    expect(post.OR).toHaveLength(2);
    expect(open.OR).toBeUndefined();
  });
});
