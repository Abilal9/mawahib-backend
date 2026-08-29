import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaPurpose,
  MediaStatus,
  NotificationType,
  PostVisibility,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  decodeFeedCursor,
  encodeFeedCursor,
  poolCursorFromPost,
} from './feed-cursor';
import {
  CommentsPageDto,
  EngagementMutationDto,
  FeedAuthorDto,
  FeedPageDto,
  FeedPostDto,
  FeedSourceDto,
  PostCommentDto,
  PostLikersPageDto,
  RelationshipStatusDto,
} from './dto/posts-response.dto';
import { CreateCommentDto, CreatePostDto } from './dto/posts.dto';
import {
  POSTS_REPOSITORY,
  type FeedPoolCursor,
  type LikePoolCursor,
  type PostAuthor,
  type PostCommentWithAuthor,
  type PostsRepository,
  type PostWithRelations,
} from './repositories/posts.repository';
import { MAX_POST_IMAGES } from './posts.constants';

const DEFAULT_LIMIT = 20;
const COMMENT_PREVIEW_MAX = 100;

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @Inject(POSTS_REPOSITORY)
    private readonly posts: PostsRepository,
    private readonly mediaService: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(authorId: string, dto: CreatePostDto): Promise<FeedPostDto> {
    const text = (dto.text ?? '').trim();
    const mediaAssetIds = dto.mediaAssetIds ?? [];
    if (!text && mediaAssetIds.length === 0) {
      throw new BadRequestException('Post requires text or at least one image');
    }
    if (mediaAssetIds.length > MAX_POST_IMAGES) {
      throw new BadRequestException(
        `Maximum ${MAX_POST_IMAGES} images per post`,
      );
    }
    const uniqueIds = [...new Set(mediaAssetIds)];
    if (uniqueIds.length !== mediaAssetIds.length) {
      throw new BadRequestException('Duplicate media assets are not allowed');
    }

    if (uniqueIds.length > 0) {
      const owned = await this.posts.findMediaAssetsReadyOwned(
        authorId,
        uniqueIds,
      );
      if (owned.length !== uniqueIds.length) {
        throw new BadRequestException(
          'All media must be ready, purpose=post, and owned by you',
        );
      }
      for (const asset of owned) {
        if (
          asset.status !== MediaStatus.ready ||
          asset.purpose !== MediaPurpose.post
        ) {
          throw new BadRequestException('Invalid media asset for post');
        }
      }
    }

    const visibility = dto.visibility ?? PostVisibility.public;
    const created = await this.posts.create({
      id: randomUUID(),
      authorId,
      text,
      visibility,
      media: uniqueIds.map((mediaAssetId, position) => ({
        mediaAssetId,
        position,
      })),
    });
    await this.posts.incrementPostsCount(authorId, 1);

    return this.toFeedPost(created, authorId, 'self', {
      status: 'self',
      connectionRequestId: null,
    }, { likeCount: 0, commentCount: 0, isLiked: false, isSaved: false });
  }

  async getById(viewerId: string, postId: string): Promise<FeedPostDto> {
    const post = await this.posts.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertCanView(viewerId, post);
    const [dto] = await this.hydrateFeedPosts(viewerId, [post]);
    return dto;
  }

  async softDelete(viewerId: string, postId: string): Promise<void> {
    const post = await this.posts.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== viewerId) {
      throw new ForbiddenException('Only the author can delete this post');
    }
    await this.posts.softDelete(postId, new Date());
    await this.posts.incrementPostsCount(viewerId, -1);
  }

  async listFeed(
    viewerId: string,
    cursorRaw?: string,
    limitRaw?: number,
  ): Promise<FeedPageDto> {
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 50);
    const cursor = decodeFeedCursor(cursorRaw);
    const peerIds = await this.posts.listActiveConnectionPeerIds(viewerId);
    const socialAuthorIds = [viewerId, ...peerIds];
    const excludeFromDiscovery = socialAuthorIds;

    const socialTarget = Math.ceil(limit * 0.7);
    const discoveryTarget = Math.floor(limit * 0.3);
    const fetchTake = limit + 5;

    const [socialRows, discoveryRows] = await Promise.all([
      this.posts.listPool({
        authorIds: socialAuthorIds,
        visibilities: [PostVisibility.public, PostVisibility.connections],
        cursor: cursor.social,
        take: fetchTake,
      }),
      this.posts.listPool({
        authorIds: [],
        visibilities: [PostVisibility.public],
        cursor: cursor.discovery,
        take: fetchTake,
        excludeAuthorIds: excludeFromDiscovery,
        discoveryMode: true,
      }),
    ]);

    const connectedSet = new Set(peerIds);
    type Picked = { post: PostWithRelations; source: FeedSourceDto };
    const picked: Picked[] = [];
    let si = 0;
    let di = 0;
    let sTaken = 0;
    let dTaken = 0;

    const classifySocial = (post: PostWithRelations): FeedSourceDto =>
      post.authorId === viewerId ? 'self' : 'connection';

    while (picked.length < limit && (si < socialRows.length || di < discoveryRows.length)) {
      const slot = picked.length % 4;
      const preferDiscovery = slot === 3;

      const canTakeSocial =
        si < socialRows.length &&
        (sTaken < socialTarget || di >= discoveryRows.length || dTaken >= discoveryTarget);
      const canTakeDiscovery =
        di < discoveryRows.length &&
        (dTaken < discoveryTarget || si >= socialRows.length || sTaken >= socialTarget);

      if (preferDiscovery && canTakeDiscovery) {
        picked.push({ post: discoveryRows[di++], source: 'discovery' });
        dTaken += 1;
      } else if (canTakeSocial) {
        const post = socialRows[si++];
        picked.push({ post, source: classifySocial(post) });
        sTaken += 1;
      } else if (canTakeDiscovery) {
        picked.push({ post: discoveryRows[di++], source: 'discovery' });
        dTaken += 1;
      } else if (si < socialRows.length) {
        const post = socialRows[si++];
        picked.push({ post, source: classifySocial(post) });
        sTaken += 1;
      } else if (di < discoveryRows.length) {
        picked.push({ post: discoveryRows[di++], source: 'discovery' });
        dTaken += 1;
      } else {
        break;
      }
    }

    // Ensure connected never labeled discovery (defensive)
    for (const item of picked) {
      if (item.source === 'discovery' && connectedSet.has(item.post.authorId)) {
        item.source = 'connection';
      }
      if (item.post.authorId === viewerId) item.source = 'self';
    }

    const seen = new Set<string>();
    const unique = picked.filter((p) => {
      if (seen.has(p.post.id)) return false;
      seen.add(p.post.id);
      return true;
    });

    const lastSocial = [...unique].reverse().find((p) => p.source !== 'discovery');
    const lastDiscovery = [...unique]
      .reverse()
      .find((p) => p.source === 'discovery');

    const nextState = {
      version: 1 as const,
      social: lastSocial
        ? poolCursorFromPost(lastSocial.post)
        : cursor.social,
      discovery: lastDiscovery
        ? poolCursorFromPost(lastDiscovery.post)
        : cursor.discovery,
    };

    const hasMore =
      unique.length >= limit &&
      (si < socialRows.length ||
        di < discoveryRows.length ||
        socialRows.length === fetchTake ||
        discoveryRows.length === fetchTake);

    const items = await this.hydrateFeedPosts(
      viewerId,
      unique.map((u) => u.post),
      unique.map((u) => u.source),
      connectedSet,
    );

    return {
      items,
      nextCursor: hasMore ? encodeFeedCursor(nextState) : null,
      hasMore,
    };
  }

  async listUserPosts(
    viewerId: string,
    authorId: string,
    cursorRaw?: string,
    limitRaw?: number,
  ): Promise<FeedPageDto> {
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 50);
    const cursor = decodeFeedCursor(cursorRaw).social;
    const peerIds = await this.posts.listActiveConnectionPeerIds(viewerId);
    const connected = peerIds.includes(authorId) || viewerId === authorId;
    const rows = await this.posts.listByAuthor(
      authorId,
      cursor,
      limit + 1,
      viewerId,
      connected,
    );
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const source: FeedSourceDto =
      authorId === viewerId
        ? 'self'
        : connected
          ? 'connection'
          : 'discovery';
    const items = await this.hydrateFeedPosts(
      viewerId,
      page,
      page.map(() => source),
      new Set(peerIds),
    );
    const next =
      hasMore && page.length > 0
        ? encodeFeedCursor({
            version: 1,
            social: poolCursorFromPost(page[page.length - 1]),
            discovery: null,
          })
        : null;
    return { items, nextCursor: next, hasMore };
  }

  async like(viewerId: string, postId: string): Promise<EngagementMutationDto> {
    const post = await this.requireVisiblePost(viewerId, postId);
    const existing = await this.posts.findLike(postId, viewerId);
    if (!existing) {
      let created = false;
      try {
        await this.posts.createLike(postId, viewerId);
        created = true;
      } catch {
        // Unique (postId,userId) — concurrent duplicate like is idempotent.
      }
      if (created && viewerId !== post.authorId) {
        await this.notifyPostLiked(post.authorId, viewerId, postId);
      }
    }
    return this.engagementState(postId, viewerId);
  }

  async unlike(viewerId: string, postId: string): Promise<EngagementMutationDto> {
    await this.requireVisiblePost(viewerId, postId);
    await this.posts.deleteLike(postId, viewerId);
    // MVP: leave existing post_liked notifications as historical activity.
    return this.engagementState(postId, viewerId);
  }

  async save(viewerId: string, postId: string): Promise<EngagementMutationDto> {
    await this.requireVisiblePost(viewerId, postId);
    const existing = await this.posts.findSave(postId, viewerId);
    if (!existing) {
      try {
        await this.posts.createSave(postId, viewerId);
      } catch {
        // Unique (postId,userId) — concurrent duplicate save is idempotent.
      }
    }
    return this.engagementState(postId, viewerId);
  }

  async unsave(viewerId: string, postId: string): Promise<EngagementMutationDto> {
    await this.requireVisiblePost(viewerId, postId);
    await this.posts.deleteSave(postId, viewerId);
    return this.engagementState(postId, viewerId);
  }

  async listLikes(
    viewerId: string,
    postId: string,
    cursorRaw?: string,
    limitRaw?: number,
  ): Promise<PostLikersPageDto> {
    await this.requireVisiblePost(viewerId, postId);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 50);
    let cursor: LikePoolCursor | null = null;
    if (cursorRaw) {
      try {
        const parsed = JSON.parse(
          Buffer.from(cursorRaw, 'base64url').toString('utf8'),
        ) as LikePoolCursor;
        if (parsed?.createdAt && parsed?.userId) cursor = parsed;
      } catch {
        cursor = null;
      }
    }
    const rows = await this.posts.listLikes(postId, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const items = page.map((row) => this.mapAuthor(row.user));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              userId: last.userId,
            }),
            'utf8',
          ).toString('base64url')
        : null;
    return { items, nextCursor, hasMore };
  }

  async listComments(
    viewerId: string,
    postId: string,
    cursorRaw?: string,
    limitRaw?: number,
  ): Promise<CommentsPageDto> {
    const post = await this.requireVisiblePost(viewerId, postId);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 50);
    let cursor: FeedPoolCursor | null = null;
    if (cursorRaw) {
      try {
        const parsed = JSON.parse(
          Buffer.from(cursorRaw, 'base64url').toString('utf8'),
        ) as FeedPoolCursor;
        if (parsed?.createdAt && parsed?.id) cursor = parsed;
      } catch {
        cursor = null;
      }
    }
    const rows = await this.posts.listComments(postId, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const items: PostCommentDto[] = page.map((c) =>
      this.mapComment(c, viewerId, post.authorId),
    );
    const nextCursor =
      hasMore && page.length > 0
        ? Buffer.from(
            JSON.stringify(poolCursorFromPost(page[page.length - 1])),
            'utf8',
          ).toString('base64url')
        : null;
    return { items, nextCursor, hasMore };
  }

  async createComment(
    viewerId: string,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<PostCommentDto> {
    const post = await this.requireVisiblePost(viewerId, postId);
    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Comment text is required');
    const created = await this.posts.createComment({
      id: randomUUID(),
      postId,
      authorId: viewerId,
      text,
    });
    if (viewerId !== post.authorId) {
      await this.notifyPostCommented(
        post.authorId,
        viewerId,
        postId,
        created.id,
        text,
      );
    }
    return this.mapComment(created, viewerId, post.authorId);
  }

  async deleteComment(viewerId: string, commentId: string): Promise<void> {
    const comment = await this.posts.findCommentById(commentId);
    if (!comment) throw new NotFoundException('Comment not found');
    const post = await this.posts.findById(comment.postId);
    if (!post) throw new NotFoundException('Comment not found');
    const canDelete =
      comment.authorId === viewerId || post.authorId === viewerId;
    if (!canDelete) {
      throw new ForbiddenException('Not allowed to delete this comment');
    }
    await this.posts.softDeleteComment(commentId, new Date());
  }

  private async requireVisiblePost(viewerId: string, postId: string) {
    const post = await this.posts.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertCanView(viewerId, post);
    return post;
  }

  private async assertCanView(viewerId: string, post: PostWithRelations) {
    if (post.authorId === viewerId) return;
    if (post.visibility === PostVisibility.public) return;
    const peers = await this.posts.listActiveConnectionPeerIds(viewerId);
    if (peers.includes(post.authorId)) return;
    throw new ForbiddenException('Post is not visible');
  }

  private async engagementState(
    postId: string,
    viewerId: string,
  ): Promise<EngagementMutationDto> {
    const [likeCount, commentCount, like, save] = await Promise.all([
      this.posts.countLikes(postId),
      this.posts.countComments(postId),
      this.posts.findLike(postId, viewerId),
      this.posts.findSave(postId, viewerId),
    ]);
    return {
      likeCount,
      commentCount,
      isLiked: Boolean(like),
      isSaved: Boolean(save),
    };
  }

  private async hydrateFeedPosts(
    viewerId: string,
    posts: PostWithRelations[],
    sources?: FeedSourceDto[],
    connectedSet?: Set<string>,
  ): Promise<FeedPostDto[]> {
    if (posts.length === 0) return [];
    const peerIds =
      connectedSet ??
      new Set(await this.posts.listActiveConnectionPeerIds(viewerId));
    const pending = await this.posts.listPendingRequestsForViewer(viewerId);
    const postIds = posts.map((p) => p.id);

    const [likes, saves, likeCounts, commentCounts] = await Promise.all([
      this.posts.listLikesForPosts(postIds, viewerId),
      this.posts.listSavesForPosts(postIds, viewerId),
      this.posts.countLikesForPosts(postIds),
      this.posts.countCommentsForPosts(postIds),
    ]);

    const liked = new Set(likes.map((l) => l.postId));
    const saved = new Set(saves.map((s) => s.postId));
    const likeMap = new Map(likeCounts.map((r) => [r.postId, r._count]));
    const commentMap = new Map(commentCounts.map((r) => [r.postId, r._count]));

    const result: FeedPostDto[] = [];
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const relationship = this.relationshipFor(
        viewerId,
        post.authorId,
        peerIds,
        pending,
      );
      let feedSource: FeedSourceDto =
        sources?.[i] ??
        (post.authorId === viewerId
          ? 'self'
          : peerIds.has(post.authorId)
            ? 'connection'
            : 'discovery');
      if (post.authorId === viewerId) feedSource = 'self';
      else if (peerIds.has(post.authorId)) feedSource = 'connection';

      result.push(
        await this.toFeedPost(post, viewerId, feedSource, relationship, {
          likeCount: likeMap.get(post.id) ?? 0,
          commentCount: commentMap.get(post.id) ?? 0,
          isLiked: liked.has(post.id),
          isSaved: saved.has(post.id),
        }),
      );
    }
    return result;
  }

  private relationshipFor(
    viewerId: string,
    authorId: string,
    peerIds: Set<string>,
    pending: Array<{ id: string; fromUserId: string; toUserId: string }>,
  ): { status: RelationshipStatusDto; connectionRequestId: string | null } {
    if (authorId === viewerId) {
      return { status: 'self', connectionRequestId: null };
    }
    if (peerIds.has(authorId)) {
      return { status: 'connected', connectionRequestId: null };
    }
    const outgoing = pending.find(
      (r) => r.fromUserId === viewerId && r.toUserId === authorId,
    );
    if (outgoing) {
      return { status: 'outgoing', connectionRequestId: outgoing.id };
    }
    const incoming = pending.find(
      (r) => r.fromUserId === authorId && r.toUserId === viewerId,
    );
    if (incoming) {
      return { status: 'incoming', connectionRequestId: incoming.id };
    }
    return { status: 'none', connectionRequestId: null };
  }

  private async toFeedPost(
    post: PostWithRelations,
    _viewerId: string,
    feedSource: FeedSourceDto,
    relationship: {
      status: RelationshipStatusDto;
      connectionRequestId: string | null;
    },
    engagement: {
      likeCount: number;
      commentCount: number;
      isLiked: boolean;
      isSaved: boolean;
    },
  ): Promise<FeedPostDto> {
    const media = [];
    for (const m of post.media) {
      const url = await this.mediaService.resolveUrlForAsset(m.mediaAsset);
      media.push({
        mediaAssetId: m.mediaAssetId,
        url,
        position: m.position,
      });
    }
    return {
      id: post.id,
      feedSource,
      author: this.mapAuthor(post.author),
      relationship,
      text: post.text,
      visibility: post.visibility,
      media,
      engagement,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  private mapAuthor(author: PostAuthor): FeedAuthorDto {
    return {
      id: author.id,
      username: author.username,
      displayName: author.displayName,
      avatarUrl: author.profile?.avatarUrl ?? null,
      accountType: author.accountType,
      title: author.profile?.title ?? null,
      isVerified: author.isVerified,
      locationCity: author.profile?.locationCity ?? null,
      locationCountry: author.profile?.locationCountry ?? null,
    };
  }

  private mapComment(
    comment: PostCommentWithAuthor,
    viewerId: string,
    postAuthorId: string,
  ): PostCommentDto {
    return {
      id: comment.id,
      postId: comment.postId,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
      author: this.mapAuthor(comment.author),
      canDelete:
        comment.authorId === viewerId || postAuthorId === viewerId,
    };
  }

  private async notifyPostLiked(
    recipientId: string,
    actorId: string,
    postId: string,
  ): Promise<void> {
    try {
      const actor = await this.posts.findUserAuthor(actorId);
      const actorName = actor?.displayName?.trim() || 'Someone';
      await this.notifications.createNotification({
        recipientId,
        actorId,
        type: NotificationType.post_liked,
        title: actorName,
        body: 'liked your post',
        payload: {
          screen: 'post',
          params: { postId },
        },
      });
    } catch (err) {
      this.logger.warn(
        `post_liked notification failed for post=${postId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async notifyPostCommented(
    recipientId: string,
    actorId: string,
    postId: string,
    commentId: string,
    text: string,
  ): Promise<void> {
    try {
      const actor = await this.posts.findUserAuthor(actorId);
      const actorName = actor?.displayName?.trim() || 'Someone';
      const preview =
        text.length > COMMENT_PREVIEW_MAX
          ? `${text.slice(0, COMMENT_PREVIEW_MAX - 1)}…`
          : text;
      await this.notifications.createNotification({
        recipientId,
        actorId,
        type: NotificationType.post_commented,
        title: actorName,
        body: 'commented on your post',
        payload: {
          screen: 'post',
          params: { postId, commentId, commentPreview: preview },
        },
      });
    } catch (err) {
      this.logger.warn(
        `post_commented notification failed for post=${postId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
