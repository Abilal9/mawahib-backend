import { Injectable } from '@nestjs/common';
import {
  MediaPurpose,
  MediaStatus,
  PostVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  CreatePostInput,
  FeedPoolCursor,
  LikePoolCursor,
  PostAuthor,
  PostCommentWithAuthor,
  PostLikeWithUser,
  PostsRepository,
  PostWithRelations,
} from './posts.repository';

const postInclude = {
  author: { include: { profile: true } },
  media: {
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.PostInclude;

const commentInclude = {
  author: { include: { profile: true } },
} satisfies Prisma.PostCommentInclude;

function cursorWhere(
  cursor: FeedPoolCursor | null,
): Prisma.PostWhereInput | undefined {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } },
    ],
  };
}

@Injectable()
export class PrismaPostsRepository implements PostsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreatePostInput): Promise<PostWithRelations> {
    return this.prisma.post.create({
      data: {
        id: input.id,
        authorId: input.authorId,
        text: input.text,
        visibility: input.visibility,
        media: {
          create: input.media.map((m) => ({
            mediaAssetId: m.mediaAssetId,
            position: m.position,
          })),
        },
      },
      include: postInclude,
    });
  }

  findById(id: string): Promise<PostWithRelations | null> {
    return this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      include: postInclude,
    });
  }

  softDelete(id: string, deletedAt: Date): Promise<PostWithRelations | null> {
    return this.prisma.post
      .update({
        where: { id },
        data: { deletedAt },
        include: postInclude,
      })
      .catch(() => null);
  }

  async listPool(input: {
    authorIds: string[];
    visibilities: PostVisibility[];
    cursor: FeedPoolCursor | null;
    take: number;
    excludeAuthorIds?: string[];
    discoveryMode?: boolean;
  }): Promise<PostWithRelations[]> {
    const where: Prisma.PostWhereInput = {
      deletedAt: null,
      visibility: { in: input.visibilities },
      author: { deletedAt: null },
      ...(cursorWhere(input.cursor) ?? {}),
    };

    if (input.discoveryMode) {
      where.authorId = {
        notIn:
          input.excludeAuthorIds && input.excludeAuthorIds.length > 0
            ? input.excludeAuthorIds
            : ['00000000-0000-0000-0000-000000000000'],
      };
    } else {
      if (input.authorIds.length === 0) return [];
      where.authorId = { in: input.authorIds };
    }

    return this.prisma.post.findMany({
      where,
      include: postInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.take,
    });
  }

  async listByAuthor(
    authorId: string,
    cursor: FeedPoolCursor | null,
    take: number,
    viewerId: string,
    connected: boolean,
  ): Promise<PostWithRelations[]> {
    const visibilities: PostVisibility[] =
      authorId === viewerId || connected
        ? [PostVisibility.public, PostVisibility.connections]
        : [PostVisibility.public];

    return this.prisma.post.findMany({
      where: {
        authorId,
        deletedAt: null,
        visibility: { in: visibilities },
        ...(cursorWhere(cursor) ?? {}),
      },
      include: postInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  countLikes(postId: string): Promise<number> {
    return this.prisma.postLike.count({ where: { postId } });
  }

  countComments(postId: string): Promise<number> {
    return this.prisma.postComment.count({
      where: { postId, deletedAt: null },
    });
  }

  findLike(postId: string, userId: string) {
    return this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
  }

  createLike(postId: string, userId: string) {
    return this.prisma.postLike.create({ data: { postId, userId } });
  }

  async deleteLike(postId: string, userId: string): Promise<void> {
    await this.prisma.postLike
      .delete({ where: { postId_userId: { postId, userId } } })
      .catch(() => undefined);
  }

  findSave(postId: string, userId: string) {
    return this.prisma.postSave.findUnique({
      where: { postId_userId: { postId, userId } },
    });
  }

  createSave(postId: string, userId: string) {
    return this.prisma.postSave.create({ data: { postId, userId } });
  }

  async deleteSave(postId: string, userId: string): Promise<void> {
    await this.prisma.postSave
      .delete({ where: { postId_userId: { postId, userId } } })
      .catch(() => undefined);
  }

  listLikesForPosts(postIds: string[], userId: string) {
    if (postIds.length === 0) return Promise.resolve([]);
    return this.prisma.postLike.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    });
  }

  listSavesForPosts(postIds: string[], userId: string) {
    if (postIds.length === 0) return Promise.resolve([]);
    return this.prisma.postSave.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    });
  }

  async countLikesForPosts(postIds: string[]) {
    if (postIds.length === 0) return [];
    const rows = await this.prisma.postLike.groupBy({
      by: ['postId'],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ postId: r.postId, _count: r._count._all }));
  }

  async countCommentsForPosts(postIds: string[]) {
    if (postIds.length === 0) return [];
    const rows = await this.prisma.postComment.groupBy({
      by: ['postId'],
      where: { postId: { in: postIds }, deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((r) => ({ postId: r.postId, _count: r._count._all }));
  }

  listComments(
    postId: string,
    cursor: FeedPoolCursor | null,
    take: number,
  ): Promise<PostCommentWithAuthor[]> {
    const where: Prisma.PostCommentWhereInput = {
      postId,
      deletedAt: null,
    };
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      // ASC conversation order: page forward to newer comments.
      where.OR = [
        { createdAt: { gt: createdAt } },
        { createdAt, id: { gt: cursor.id } },
      ];
    }
    return this.prisma.postComment.findMany({
      where,
      include: commentInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
  }

  listLikes(
    postId: string,
    cursor: LikePoolCursor | null,
    take: number,
  ): Promise<PostLikeWithUser[]> {
    const where: Prisma.PostLikeWhereInput = {
      postId,
      user: { deletedAt: null },
    };
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      where.OR = [
        { createdAt: { lt: createdAt } },
        { createdAt, userId: { lt: cursor.userId } },
      ];
    }
    return this.prisma.postLike.findMany({
      where,
      include: { user: { include: { profile: true } } },
      orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
      take,
    });
  }

  createComment(input: {
    id: string;
    postId: string;
    authorId: string;
    text: string;
  }): Promise<PostCommentWithAuthor> {
    return this.prisma.postComment.create({
      data: input,
      include: commentInclude,
    });
  }

  findCommentById(id: string): Promise<PostCommentWithAuthor | null> {
    return this.prisma.postComment.findFirst({
      where: { id, deletedAt: null },
      include: commentInclude,
    });
  }

  softDeleteComment(
    id: string,
    deletedAt: Date,
  ): Promise<PostCommentWithAuthor | null> {
    return this.prisma.postComment
      .update({
        where: { id },
        data: { deletedAt },
        include: commentInclude,
      })
      .catch(() => null);
  }

  findUserAuthor(userId: string): Promise<PostAuthor | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { profile: true },
    });
  }

  findMediaAssetsReadyOwned(ownerId: string, mediaAssetIds: string[]) {
    if (mediaAssetIds.length === 0) return Promise.resolve([]);
    return this.prisma.mediaAsset.findMany({
      where: {
        id: { in: mediaAssetIds },
        ownerId,
        status: MediaStatus.ready,
        deletedAt: null,
        purpose: MediaPurpose.post,
      },
    });
  }

  async incrementPostsCount(userId: string, delta: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { postsCount: { increment: delta } },
    });
  }

  async listActiveConnectionPeerIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.connection.findMany({
      where: {
        endedAt: null,
        OR: [{ userLowId: userId }, { userHighId: userId }],
      },
      select: { userLowId: true, userHighId: true },
    });
    return rows.map((r) =>
      r.userLowId === userId ? r.userHighId : r.userLowId,
    );
  }

  listPendingRequestsForViewer(viewerId: string) {
    return this.prisma.connectionRequest.findMany({
      where: {
        status: 'pending',
        OR: [{ fromUserId: viewerId }, { toUserId: viewerId }],
      },
      select: { id: true, fromUserId: true, toUserId: true },
    });
  }
}
