import { PostVisibility, Prisma } from '@prisma/client';

/**
 * Profile-list visibility for one page of authors.
 * Authors count their own non-deleted posts, including posts Mawahib hid.
 * Everyone else counts only posts that list would return: not deleted, not
 * staff-hidden, public, plus connections when the viewer is an active peer.
 * One grouped query, not one query per post.
 */
export function visiblePostsWhere(input: {
  authorIds: string[];
  viewerId: string | null;
  peerIds: string[];
}): Prisma.PostWhereInput {
  const visibility: Prisma.PostWhereInput[] = [
    { visibility: PostVisibility.public },
  ];
  if (input.viewerId && input.authorIds.includes(input.viewerId)) {
    visibility.push({ authorId: input.viewerId });
  }
  if (input.peerIds.length > 0) {
    visibility.push({
      visibility: PostVisibility.connections,
      authorId: { in: input.peerIds },
    });
  }
  const hidden: Prisma.PostWhereInput = input.viewerId
    ? { OR: [{ staffHiddenAt: null }, { authorId: input.viewerId }] }
    : { staffHiddenAt: null };
  return {
    authorId: { in: input.authorIds },
    deletedAt: null,
    AND: [hidden, { OR: visibility }],
  };
}

type CountRow = { authorId: string; _count: { _all: number } };

type CountClient = {
  post: {
    groupBy: (args: {
      by: ['authorId'];
      where: Prisma.PostWhereInput;
      _count: { _all: true };
    }) => Promise<CountRow[]>;
  };
  connection: {
    findMany: (args: {
      where: Prisma.ConnectionWhereInput;
      select: { userLowId: true; userHighId: true };
    }) => Promise<Array<{ userLowId: string; userHighId: string }>>;
  };
};

export async function activePeerIds(
  prisma: CountClient,
  viewerId: string,
): Promise<string[]> {
  const rows = await prisma.connection.findMany({
    where: {
      endedAt: null,
      OR: [{ userLowId: viewerId }, { userHighId: viewerId }],
    },
    select: { userLowId: true, userHighId: true },
  });
  return rows.map((row) =>
    row.userLowId === viewerId ? row.userHighId : row.userLowId,
  );
}

export async function countVisiblePosts(
  prisma: CountClient,
  authorIds: string[],
  viewerId: string | null,
  peerIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(authorIds)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.post.groupBy({
    by: ['authorId'],
    where: visiblePostsWhere({ authorIds: unique, viewerId, peerIds }),
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.authorId, row._count._all]));
}
