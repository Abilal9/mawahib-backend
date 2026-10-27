import { PostVisibility, Prisma } from '@prisma/client';
import { SaveCursor, saveKeyset } from '../../common/save-cursor';

/**
 * Saved-post predicate. Runs inside the paged query, before LIMIT.
 * A connections post stays out unless the viewer is the author or an active peer.
 */
export function savedPostWhere(
  viewerId: string,
  peerIds: string[],
  cursor: SaveCursor | null,
): Prisma.PostSaveWhereInput {
  const visibility: Prisma.PostWhereInput[] = [
    { authorId: viewerId },
    { visibility: PostVisibility.public },
  ];
  if (peerIds.length > 0) {
    visibility.push({
      visibility: PostVisibility.connections,
      authorId: { in: peerIds },
    });
  }
  return {
    userId: viewerId,
    post: {
      deletedAt: null,
      author: { deletedAt: null },
      OR: visibility,
    },
    ...saveKeyset('postId', cursor),
  };
}
