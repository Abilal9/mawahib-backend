import {
  MediaAsset,
  Post,
  PostComment,
  PostLike,
  PostMedia,
  PostSave,
  PostVisibility,
  Profile,
  User,
} from '@prisma/client';

export type PostAuthor = User & { profile: Profile | null };

export type PostWithRelations = Post & {
  author: PostAuthor;
  media: Array<PostMedia & { mediaAsset: MediaAsset }>;
  _count?: { likes: number; comments: number };
};

export type PostCommentWithAuthor = PostComment & {
  author: PostAuthor;
};

export type PostLikeWithUser = PostLike & {
  user: PostAuthor;
};

export type LikePoolCursor = {
  createdAt: string;
  userId: string;
};

export type FeedPoolCursor = {
  createdAt: string;
  id: string;
};

export type FeedCursorState = {
  version: 1;
  social: FeedPoolCursor | null;
  discovery: FeedPoolCursor | null;
};

export type CreatePostInput = {
  id: string;
  authorId: string;
  text: string;
  visibility: PostVisibility;
  media: Array<{ mediaAssetId: string; position: number }>;
};

export interface PostsRepository {
  create(input: CreatePostInput): Promise<PostWithRelations>;
  findById(id: string): Promise<PostWithRelations | null>;
  softDelete(id: string, deletedAt: Date): Promise<PostWithRelations | null>;
  listPool(input: {
    authorIds: string[];
    visibilities: PostVisibility[];
    cursor: FeedPoolCursor | null;
    take: number;
    excludeAuthorIds?: string[];
    /** When true, authorIds are ignored; all authors except excludeAuthorIds */
    discoveryMode?: boolean;
  }): Promise<PostWithRelations[]>;
  listByAuthor(
    authorId: string,
    cursor: FeedPoolCursor | null,
    take: number,
    viewerId: string,
    connected: boolean,
  ): Promise<PostWithRelations[]>;
  countLikes(postId: string): Promise<number>;
  countComments(postId: string): Promise<number>;
  findLike(postId: string, userId: string): Promise<PostLike | null>;
  createLike(postId: string, userId: string): Promise<PostLike>;
  deleteLike(postId: string, userId: string): Promise<void>;
  findSave(postId: string, userId: string): Promise<PostSave | null>;
  createSave(postId: string, userId: string): Promise<PostSave>;
  deleteSave(postId: string, userId: string): Promise<void>;
  listLikesForPosts(
    postIds: string[],
    userId: string,
  ): Promise<Array<{ postId: string }>>;
  listSavesForPosts(
    postIds: string[],
    userId: string,
  ): Promise<Array<{ postId: string }>>;
  countLikesForPosts(
    postIds: string[],
  ): Promise<Array<{ postId: string; _count: number }>>;
  countCommentsForPosts(
    postIds: string[],
  ): Promise<Array<{ postId: string; _count: number }>>;
  listComments(
    postId: string,
    cursor: FeedPoolCursor | null,
    take: number,
  ): Promise<PostCommentWithAuthor[]>;
  listLikes(
    postId: string,
    cursor: LikePoolCursor | null,
    take: number,
  ): Promise<PostLikeWithUser[]>;
  createComment(input: {
    id: string;
    postId: string;
    authorId: string;
    text: string;
  }): Promise<PostCommentWithAuthor>;
  findCommentById(id: string): Promise<PostCommentWithAuthor | null>;
  softDeleteComment(
    id: string,
    deletedAt: Date,
  ): Promise<PostCommentWithAuthor | null>;
  findUserAuthor(userId: string): Promise<PostAuthor | null>;
  findMediaAssetsReadyOwned(
    ownerId: string,
    mediaAssetIds: string[],
  ): Promise<MediaAsset[]>;
  incrementPostsCount(userId: string, delta: number): Promise<void>;
  listActiveConnectionPeerIds(userId: string): Promise<string[]>;
  listPendingRequestsForViewer(viewerId: string): Promise<
    Array<{
      id: string;
      fromUserId: string;
      toUserId: string;
    }>
  >;
}

export const POSTS_REPOSITORY = Symbol('POSTS_REPOSITORY');
