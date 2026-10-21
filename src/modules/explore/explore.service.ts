import { Inject, Injectable, Logger } from '@nestjs/common';
import { PackageTier } from '@prisma/client';
import { MediaService } from '../media/media.service';
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
  ratingAvg: number;
  ratingCount: number;
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
  /**
   * Provider aggregate. Not ServiceOffering.ratingAvg.
   * Cards must label this as the provider's rating.
   */
  rating: number;
  reviewCount: number;
  images: string[];
  exploreTag: string | null;
  provider: ExploreProfileDto;
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
    const filter = {
      viewerId,
      q,
      locationCode,
      sort,
      skip,
      take,
      categoryIds,
      searchSkillIds,
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
          })
        : Promise.resolve([]),
    ]);
    const users = await this.explore.loadUsers(page.ids);
    return {
      items: users.map((user) => this.mapProfile(user)),
      businesses: businesses.map((user) => this.mapProfile(user)),
      total: page.total,
      take,
      skip,
    };
  }

  async listServices(
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
    const page = await this.explore.searchServices({
      q,
      locationCode: normalizeCode(query.locationCode),
      categoryIds,
      searchSkillIds,
      skip,
      take,
    });
    const offerings = await this.explore.loadServices(page.ids);
    const imagesByOffering = await this.signServiceImages(offerings);
    return {
      items: offerings.map((offering) =>
        this.mapService(offering, imagesByOffering.get(offering.id) ?? []),
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
  ): ExploreServiceDto {
    const basic =
      offering.packages.find((pkg) => pkg.tier === PackageTier.basic) ??
      offering.packages[0];
    const provider = this.mapProfile(offering.user);
    return {
      id: offering.id,
      title: offering.title,
      description: offering.description,
      category: offering.category,
      price: basic ? Number(basic.price) : null,
      currency: offering.currency,
      duration: basic?.deliveryLabel ?? '',
      rating: provider.ratingAvg,
      reviewCount: provider.ratingCount,
      images,
      exploreTag: offering.category,
      provider,
    };
  }

  private mapProfile(user: ExploreUserRecord): ExploreProfileDto {
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
      ratingAvg: Number(user.ratingAvg),
      ratingCount: user.ratingCount,
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
