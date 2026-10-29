import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaPurpose, MediaStatus } from '@prisma/client';
import { mapPool } from '../../common/map-pool';
import {
  decodeSaveCursor,
  encodeSaveCursor,
} from '../../common/save-cursor';
import { MediaService } from '../media/media.service';
import { ReviewClock } from '../reviews/review-clock';
import { ReviewsService } from '../reviews/reviews.service';
import { EMPTY_AGGREGATE, EMPTY_REVIEW_SUMMARY } from '../reviews/review-summary';
import { TaxonomyFilterService } from '../taxonomy/taxonomy-filter.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import type {
  GuestExplorePage,
  GuestExploreService,
  GuestExploreTalent,
  GuestJob,
  GuestJobPage,
  GuestPortfolio,
  GuestPost,
  GuestPostPage,
  GuestProfile,
  GuestReviewPage,
  GuestService,
} from './dto/guest.dto';
import type {
  PublicFeedQueryDto,
  PublicListQueryDto,
  PublicSearchQueryDto,
} from './dto/public-query.dto';
import {
  toGuestExploreService,
  toGuestExploreTalent,
  toGuestJob,
  toGuestPortfolio,
  toGuestPost,
  toGuestProfile,
  toGuestReview,
  toGuestService,
} from './guest.mappers';
import { PUBLIC_DEFAULT_TAKE, PUBLIC_SIGN_CONCURRENCY } from './public.constants';
import {
  PublicRepository,
  type PublicPostRecord,
  type PublicServiceRecord,
} from './public.repository';

function hidden(): never {
  throw new NotFoundException();
}

function pageTake(raw?: number): number {
  return raw ?? PUBLIC_DEFAULT_TAKE;
}

@Injectable()
export class PublicService {
  constructor(
    private readonly publicRepo: PublicRepository,
    private readonly media: MediaService,
    private readonly reviews: ReviewsService,
    private readonly reviewClock: ReviewClock,
    private readonly taxonomy: TaxonomyService,
    private readonly taxonomyFilters: TaxonomyFilterService,
  ) {}

  async listFeed(query: PublicFeedQueryDto): Promise<GuestPostPage> {
    const take = pageTake(query.take);
    const cursor = decodeSaveCursor(query.cursor);
    const rows = await this.publicRepo.listPublicFeed({
      cursor,
      take: take + 1,
    });
    return this.toPostPage(rows, take);
  }

  async getPost(id: string): Promise<GuestPost> {
    const row = await this.publicRepo.findPublicPost(id);
    if (!row) hidden();
    const [page] = await this.hydratePosts([row]);
    return page;
  }

  async getProfile(userId: string): Promise<GuestProfile> {
    const user = await this.requireDiscoverableUser(userId);
    const summary =
      (await this.reviews.summarizeUsers([user.id], this.reviewClock.now())).get(
        user.id,
      ) ?? EMPTY_REVIEW_SUMMARY;
    return toGuestProfile(user, summary);
  }

  async listUserPosts(
    userId: string,
    query: PublicListQueryDto,
  ): Promise<GuestPostPage> {
    await this.requireDiscoverableUser(userId);
    const take = pageTake(query.take);
    const rows = await this.publicRepo.listPublicUserPosts({
      authorId: userId,
      cursor: decodeSaveCursor(query.cursor),
      take: take + 1,
    });
    return this.toPostPage(rows, take);
  }

  async listUserServices(userId: string): Promise<GuestService[]> {
    const owner = await this.requireDiscoverableUser(userId);
    const rows = await this.publicRepo.listPublicUserServices(userId);
    return this.hydrateServices(rows, owner);
  }

  async listUserPortfolio(userId: string): Promise<GuestPortfolio[]> {
    await this.requireDiscoverableUser(userId);
    const rows = await this.publicRepo.listPublicUserPortfolio(userId);
    return Promise.all(
      rows.map(async (project) =>
        toGuestPortfolio({
          id: project.id,
          title: project.title,
          description: project.description,
          images: await this.signParentMedia(
            project.media.map((media) => media.mediaAsset),
            MediaPurpose.portfolio,
          ),
        }),
      ),
    );
  }

  async listUserReviews(
    userId: string,
    query: PublicListQueryDto,
  ): Promise<GuestReviewPage> {
    await this.requireDiscoverableUser(userId);
    const page = await this.reviews.listReceived({
      userId,
      cursor: query.cursor,
      limit: pageTake(query.take),
      asOf: this.reviewClock.now(),
    });
    return this.toReviewPage(page);
  }

  async getService(id: string): Promise<GuestService> {
    const row = await this.publicRepo.findPublicService(id);
    if (!row) hidden();
    const [mapped] = await this.hydrateServices([row], row.user);
    return mapped;
  }

  async listServiceReviews(
    serviceId: string,
    query: PublicListQueryDto,
  ): Promise<GuestReviewPage> {
    const service = await this.publicRepo.findPublicService(serviceId);
    if (!service) hidden();
    const page = await this.reviews.listForService({
      serviceId: service.id,
      cursor: query.cursor,
      limit: pageTake(query.take),
      asOf: this.reviewClock.now(),
    });
    return this.toReviewPage(page);
  }

  async listJobs(query: PublicSearchQueryDto): Promise<GuestJobPage> {
    const take = pageTake(query.take);
    const skip = query.skip ?? 0;
    const rows = await this.publicRepo.listPublicOpenJobs({
      take,
      skip,
      q: query.q,
    });
    return {
      items: rows.map((row) => toGuestJob(row)),
      take,
      skip,
    };
  }

  async getJob(id: string): Promise<GuestJob> {
    const row = await this.publicRepo.findPublicOpenJob(id);
    if (!row) hidden();
    return toGuestJob(row);
  }

  async listExploreTalents(
    query: PublicSearchQueryDto,
  ): Promise<GuestExplorePage<GuestExploreTalent>> {
    const take = pageTake(query.take);
    const skip = query.skip ?? 0;
    const q = query.q;
    const searchSkillIds = await this.taxonomyFilters.resolveSearchSkillIds(q);
    const ids = await this.publicRepo.searchPublicTalents({
      q,
      searchSkillIds,
      take,
      skip,
      asOf: this.reviewClock.now(),
    });
    const users = await this.publicRepo.loadDiscoverableUsers(ids);
    const byId = new Map(users.map((user) => [user.id, user]));
    const ordered = ids.flatMap((id) => {
      const user = byId.get(id);
      return user ? [user] : [];
    });
    const summaries = await this.reviews.summarizeUsers(
      ordered.map((user) => user.id),
      this.reviewClock.now(),
    );
    return {
      items: ordered.map((user) =>
        toGuestExploreTalent(
          user,
          summaries.get(user.id) ?? EMPTY_REVIEW_SUMMARY,
        ),
      ),
      take,
      skip,
    };
  }

  async listExploreServices(
    query: PublicSearchQueryDto,
  ): Promise<GuestExplorePage<GuestExploreService>> {
    const take = pageTake(query.take);
    const skip = query.skip ?? 0;
    const q = query.q;
    const searchSkillIds = await this.taxonomyFilters.resolveSearchSkillIds(q);
    const ids = await this.publicRepo.searchPublicServices({
      q,
      searchSkillIds,
      take,
      skip,
      asOf: this.reviewClock.now(),
    });
    const rows = await this.publicRepo.loadPublicServices(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    const summaries = await this.reviews.summarizeServices(
      ordered.map((row) => row.id),
      this.reviewClock.now(),
    );
    const items = await Promise.all(
      ordered.map(async (row) =>
        toGuestExploreService({
          id: row.id,
          title: row.title,
          description: row.description,
          category: row.category,
          images: await this.signParentMedia(
            row.media.map((media) => media.mediaAsset),
            MediaPurpose.service,
          ),
          reviewSummary: summaries.get(row.id) ?? EMPTY_AGGREGATE,
          provider: row.user,
        }),
      ),
    );
    return { items, take, skip };
  }

  listTaxonomy() {
    return this.taxonomy.list();
  }

  private async requireDiscoverableUser(userId: string) {
    const user = await this.publicRepo.findDiscoverableUser(userId);
    if (!user) hidden();
    return user;
  }

  private async toPostPage(
    rows: PublicPostRecord[],
    take: number,
  ): Promise<GuestPostPage> {
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = await this.hydratePosts(page);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeSaveCursor(last.createdAt, last.id) : null,
    };
  }

  private async hydratePosts(posts: PublicPostRecord[]): Promise<GuestPost[]> {
    if (posts.length === 0) return [];
    const ids = posts.map((post) => post.id);
    const [likes, comments, mediaByPost] = await Promise.all([
      this.publicRepo.countLikesForPosts(ids),
      this.publicRepo.countCommentsForPosts(ids),
      this.signPostMedia(posts),
    ]);
    const likeMap = new Map(likes.map((row) => [row.postId, row._count]));
    const commentMap = new Map(
      comments.map((row) => [row.postId, row._count]),
    );
    return posts.map((post) =>
      toGuestPost({
        id: post.id,
        text: post.text,
        createdAt: post.createdAt,
        author: post.author,
        media: mediaByPost.get(post.id) ?? [],
        likeCount: likeMap.get(post.id) ?? 0,
        commentCount: commentMap.get(post.id) ?? 0,
      }),
    );
  }

  private async hydrateServices(
    rows: PublicServiceRecord[],
    owner: PublicServiceRecord['user'] | Awaited<ReturnType<PublicRepository['findDiscoverableUser']>>,
  ): Promise<GuestService[]> {
    if (rows.length === 0) return [];
    const summaries = await this.reviews.summarizeServices(
      rows.map((row) => row.id),
      this.reviewClock.now(),
    );
    return Promise.all(
      rows.map(async (row) =>
        toGuestService({
          offering: row,
          images: await this.signParentMedia(
            row.media.map((media) => media.mediaAsset),
            MediaPurpose.service,
          ),
          provider: row.user ?? owner,
          reviewSummary: summaries.get(row.id) ?? EMPTY_AGGREGATE,
        }),
      ),
    );
  }

  private async toReviewPage(page: {
    items: Array<{
      id: string;
      rating: number;
      body: string;
      createdAt: Date;
      reviewer: {
        id: string;
        displayName: string;
        username: string;
        accountType: string;
        profile?: { avatarUrl: string | null; title: string | null } | null;
      };
        media?: Array<{
          mediaAssetId: string;
          mediaAsset: {
            mimeType: string;
            purpose?: MediaPurpose;
            status?: MediaStatus;
            deletedAt?: Date | null;
          };
        }>;
    }>;
    nextCursor: string | null;
  }): Promise<GuestReviewPage> {
    const items = await Promise.all(
      page.items.map(async (item) =>
        toGuestReview({
          id: item.id,
          rating: item.rating,
          body: item.body,
          createdAt: item.createdAt,
          reviewer: {
            id: item.reviewer.id,
            displayName: item.reviewer.displayName,
            username: item.reviewer.username,
            accountType: item.reviewer.accountType,
            profile: item.reviewer.profile,
          },
          media: (
            await Promise.all(
              (item.media ?? []).map(async (media) => {
                if (!isPublicSignableAsset(media.mediaAsset, MediaPurpose.review)) {
                  return null;
                }
                const url = await this.media.getSignedUrlForAsset(
                  media.mediaAssetId,
                );
                return url
                  ? { url, mimeType: media.mediaAsset.mimeType }
                  : null;
              }),
            )
          ).filter((row): row is { url: string; mimeType: string } =>
            Boolean(row),
          ),
        }),
      ),
    );
    return { items, nextCursor: page.nextCursor };
  }

  private async signPostMedia(posts: PublicPostRecord[]) {
    const tasks = posts.flatMap((post) =>
      post.media.map((media) => ({ postId: post.id, media })),
    );
    const signed = await mapPool(tasks, PUBLIC_SIGN_CONCURRENCY, async (task) => {
      if (!isPublicSignableAsset(task.media.mediaAsset, MediaPurpose.post)) {
        return { postId: task.postId, item: null };
      }
      const url = await this.media.resolveUrlForAsset(task.media.mediaAsset);
      return {
        postId: task.postId,
        item: url ? { url, position: task.media.position } : null,
      };
    });
    const grouped = new Map<string, Array<{ url: string; position: number }>>();
    for (const row of signed) {
      if (!row.item) continue;
      const list = grouped.get(row.postId) ?? [];
      list.push(row.item);
      grouped.set(row.postId, list);
    }
    return grouped;
  }

  private async signParentMedia(
    assets: Array<{
      bucket: string;
      objectKey: string;
      status: MediaStatus;
      purpose?: MediaPurpose;
      deletedAt?: Date | null;
    }>,
    purpose: MediaPurpose,
  ): Promise<string[]> {
    const allowed = assets.filter((asset) =>
      isPublicSignableAsset(asset, purpose),
    );
    const urls = await mapPool(allowed, PUBLIC_SIGN_CONCURRENCY, (asset) =>
      this.media.resolveUrlForAsset(asset),
    );
    return urls.filter((url): url is string => Boolean(url));
  }
}

function isPublicSignableAsset(
  asset: {
    purpose?: MediaPurpose;
    status?: MediaStatus;
    deletedAt?: Date | null;
  },
  purpose: MediaPurpose,
): boolean {
  return (
    asset.purpose === purpose &&
    asset.status === MediaStatus.ready &&
    !asset.deletedAt
  );
}
