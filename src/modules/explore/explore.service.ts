import { Inject, Injectable, Logger } from '@nestjs/common';
import { PackageTier } from '@prisma/client';
import { MediaService } from '../media/media.service';
import { ReviewClock } from '../reviews/review-clock';
import { ReviewsService } from '../reviews/reviews.service';
import {
  EMPTY_AGGREGATE,
  EMPTY_REVIEW_SUMMARY,
  type ReviewAggregate,
  type ReviewSummaryPair,
} from '../reviews/review-summary';
import { ServicesService } from '../services/services.service';
import { TaxonomyFilterService } from '../taxonomy/taxonomy-filter.service';
import {
  EXPLORE_DEFAULT_TAKE,
  ExploreServiceQueryDto,
  ExploreTalentQueryDto,
} from './dto/explore-query.dto';
import {
  EXPLORE_REPOSITORY,
  type ExploreRepository,
  type ExploreServiceRecord,
  type ExploreUserRecord,
} from './repositories/explore.repository';

export const EXPLORE_SIGN_CONCURRENCY = 5;

export type ExploreProfileDto = {
  id: string;
  displayName: string;
  username: string;
  accountType: string;
  isVerified: boolean;
  title: string | null;
  bio: string;
  locationCity: string | null;
  locationCountry: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  skills: string[];
  followersCount: number;
  followingCount: number;
  postsCount: number;
  reviewSummary: ReviewSummaryPair;
};

export type ExploreServiceDto = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  /** Null when the offering has no package. A real package price of 0 stays 0. */
  price: number | null;
  currency: string;
  duration: string;
  reviewSummary: ReviewAggregate;
  images: string[];
  exploreTag: string | null;
  provider: ExploreProfileDto;
  isSaved: boolean;
};

export type ExploreTalentPageDto = {
  items: ExploreProfileDto[];
  businesses: ExploreProfileDto[];
  total: number;
  take: number;
  skip: number;
};

export type ExploreServicePageDto = {
  items: ExploreServiceDto[];
  total: number;
  take: number;
  skip: number;
};

@Injectable()
export class ExploreService {
  private readonly logger = new Logger(ExploreService.name);

  constructor(
    @Inject(EXPLORE_REPOSITORY)
    private readonly explore: ExploreRepository,
    private readonly mediaService: MediaService,
    private readonly taxonomyFilters: TaxonomyFilterService,
    private readonly services: ServicesService,
    private readonly reviews: ReviewsService,
    private readonly reviewClock: ReviewClock,
  ) {}

  async listTalents(
    viewerId: string,
    query: ExploreTalentQueryDto,
  ): Promise<ExploreTalentPageDto> {
    const take = query.take ?? EXPLORE_DEFAULT_TAKE;
    const skip = query.skip ?? 0;
    const q = query.q?.trim() || undefined;
    const locationCode = normalizeCode(query.locationCode);
    const sort = query.sort ?? 'recommended';
    const categoryIds = query.categoryIds;
    const [searchSkillIds] = await Promise.all([
      this.taxonomyFilters.resolveSearchSkillIds(q),
      this.taxonomyFilters.assertActiveCategories(categoryIds),
    ]);
    const asOf = this.reviewClock.now();
    const filter = {
      viewerId,
      q,
      locationCode,
      sort,
      skip,
      take,
      categoryIds,
      searchSkillIds,
      asOf,
    };
    const taxonomyActive = Boolean(categoryIds?.length);
    const [page, businesses] = await Promise.all([
      this.explore.searchTalents(filter),
      q && skip === 0 && !taxonomyActive
        ? this.explore.searchBusinesses({
            viewerId,
            q,
            locationCode,
            sort,
            skip,
            take,
            asOf,
          })
        : Promise.resolve([]),
    ]);
    const users = await this.explore.loadUsers(page.ids);
    const summaries = await this.reviews.summarizeUsers(
      [...users, ...businesses].map((user) => user.id),
      asOf,
    );
    return {
      items: users.map((user) =>
        this.mapProfile(user, summaries.get(user.id) ?? EMPTY_REVIEW_SUMMARY),
      ),
      businesses: businesses.map((user) =>
        this.mapProfile(user, summaries.get(user.id) ?? EMPTY_REVIEW_SUMMARY),
      ),
      total: page.total,
      take,
      skip,
    };
  }

  async listServices(
    viewerId: string,
    query: ExploreServiceQueryDto,
  ): Promise<ExploreServicePageDto> {
    const take = query.take ?? EXPLORE_DEFAULT_TAKE;
    const skip = query.skip ?? 0;
    const categoryIds = query.categoryIds;
    const q = query.q?.trim() || undefined;
    const [searchSkillIds] = await Promise.all([
      this.taxonomyFilters.resolveSearchSkillIds(q),
      this.taxonomyFilters.assertActiveCategories(categoryIds),
    ]);
    const asOf = this.reviewClock.now();
    const page = await this.explore.searchServices({
      q,
      locationCode: normalizeCode(query.locationCode),
      categoryIds,
      searchSkillIds,
      skip,
      take,
      asOf,
    });
    const offerings = await this.explore.loadServices(page.ids);
    const [imagesByOffering, savedIds] = await Promise.all([
      this.signServiceImages(offerings),
      this.services.savedServiceIds(
        viewerId,
        offerings.map((offering) => offering.id),
      ),
    ]);
    const saved = new Set(savedIds);
    const [serviceSummaries, providerSummaries] = await Promise.all([
      this.reviews.summarizeServices(
        offerings.map((offering) => offering.id),
        asOf,
      ),
      this.reviews.summarizeUsers(
        offerings.map((offering) => offering.userId),
        asOf,
      ),
    ]);
    return {
      items: offerings.map((offering) =>
        this.mapService(
          offering,
          imagesByOffering.get(offering.id) ?? [],
          saved.has(offering.id),
          serviceSummaries.get(offering.id) ?? EMPTY_AGGREGATE,
          providerSummaries.get(offering.userId) ?? EMPTY_REVIEW_SUMMARY,
        ),
      ),
      total: page.total,
      take,
      skip,
    };
  }

  private async signServiceImages(
    offerings: ExploreServiceRecord[],
  ): Promise<Map<string, string[]>> {
    const tasks = offerings.flatMap((offering) =>
      offering.media.map((media) => ({ offeringId: offering.id, media })),
    );
    const resolved = await mapPool(tasks, EXPLORE_SIGN_CONCURRENCY, async (task) => {
      try {
        const url = await this.mediaService.resolveUrlForAsset(task.media.mediaAsset);
        return { offeringId: task.offeringId, url };
      } catch (error) {
        this.logger.warn(
          `Explore skipped service image ${task.media.mediaAssetId}: ${
            error instanceof Error ? error.message : 'unreadable'
          }`,
        );
        return { offeringId: task.offeringId, url: null };
      }
    });
    const images = new Map<string, string[]>();
    for (const item of resolved) {
      if (!item.url) continue;
      const list = images.get(item.offeringId) ?? [];
      list.push(item.url);
      images.set(item.offeringId, list);
    }
    return images;
  }

  private mapService(
    offering: ExploreServiceRecord,
    images: string[],
    isSaved: boolean,
    reviewSummary: ReviewAggregate,
    providerSummary: ReviewSummaryPair,
  ): ExploreServiceDto {
    const basic =
      offering.packages.find((pkg) => pkg.tier === PackageTier.basic) ??
      offering.packages[0];
    const provider = this.mapProfile(offering.user, providerSummary);
    return {
      id: offering.id,
      title: offering.title,
      description: offering.description,
      category: offering.category,
      price: basic ? Number(basic.price) : null,
      currency: offering.currency,
      duration: basic?.deliveryLabel ?? '',
      reviewSummary,
      images,
      exploreTag: offering.category,
      provider,
      isSaved,
    };
  }

  private mapProfile(
    user: ExploreUserRecord,
    reviewSummary: ReviewSummaryPair,
  ): ExploreProfileDto {
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      accountType: user.accountType,
      isVerified: user.isVerified,
      title: user.profile?.title ?? null,
      bio: user.profile?.bio ?? '',
      locationCity: user.profile?.locationCity ?? null,
      locationCountry: user.profile?.locationCountry ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      coverUrl: user.profile?.coverUrl ?? null,
      skills: [...user.skills]
        .sort((a, b) => a.position - b.position)
        .map((skill) => skill.skill),
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      postsCount: user.postsCount,
      reviewSummary,
    };
  }
}

function normalizeCode(value?: string): string | undefined {
  const code = value?.trim().toLowerCase();
  return code || undefined;
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
