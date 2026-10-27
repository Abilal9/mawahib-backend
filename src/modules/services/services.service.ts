import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PackageTier } from '@prisma/client';
import { isUniqueViolation } from '../../common/prisma-errors';
import {
  decodeSaveCursor,
  encodeSaveCursor,
  savePageLimit,
} from '../../common/save-cursor';
import { canSaveService } from './saved-service.query';
import { randomUUID } from 'crypto';
import {
  currencyForCountry,
  DEFAULT_CURRENCY,
  normalizeCountryCode,
} from '../../common/location/geo';
import { MediaService } from '../media/media.service';
import { ReviewClock } from '../reviews/review-clock';
import { ListServiceReviewsQueryDto } from '../reviews/dto/list-reviews.dto';
import { ReviewsService } from '../reviews/reviews.service';
import { EMPTY_AGGREGATE } from '../reviews/review-summary';
import { isVideoMime } from '../portfolio/dto/portfolio-response.dto';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import type { UserRepository } from '../users/repositories/user.repository';
import {
  CreateServiceOfferingDto,
  ReorderServicesDto,
  UpdateServiceOfferingDto,
} from './dto/service.dto';
import { ServiceOfferingResponseDto } from './dto/service-response.dto';
import { SERVICE_OFFERING_REPOSITORY } from './repositories/service-offering.repository';
import type {
  ServiceOfferingRepository,
  ServiceOfferingWithDetails,
} from './repositories/service-offering.repository';

@Injectable()
export class ServicesService {
  constructor(
    @Inject(SERVICE_OFFERING_REPOSITORY)
    private readonly offerings: ServiceOfferingRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    private readonly mediaService: MediaService,
    private readonly reviews: ReviewsService,
    private readonly reviewClock: ReviewClock,
  ) {}

  async listMine(userId: string): Promise<ServiceOfferingResponseDto[]> {
    const rows = await this.offerings.listByUser(userId);
    return this.mapMany(rows);
  }

  async listByUser(
    ownerId: string,
    viewerId: string,
  ): Promise<ServiceOfferingResponseDto[]> {
    const rows = await this.offerings.listByUser(ownerId, {
      publishedOnly: true,
    });
    return this.withSavedFlags(viewerId, rows);
  }

  async savedServiceIds(
    viewerId: string,
    serviceIds: string[],
  ): Promise<string[]> {
    return this.offerings.listServiceSaveIds(viewerId, serviceIds);
  }

  async save(
    viewerId: string,
    serviceId: string,
  ): Promise<{ isSaved: true }> {
    const offering = await this.offerings.findSaveTarget(serviceId);
    if (
      !offering ||
      !canSaveService({
        status: offering.status,
        deletedAt: offering.deletedAt,
        ownerDeletedAt: offering.user.deletedAt,
      })
    ) {
      throw new NotFoundException('Service not found');
    }
    try {
      await this.offerings.createServiceSave(serviceId, viewerId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    return { isSaved: true };
  }

  async unsave(
    viewerId: string,
    serviceId: string,
  ): Promise<{ isSaved: false }> {
    await this.offerings.deleteServiceSave(serviceId, viewerId);
    return { isSaved: false };
  }

  async listSaved(
    viewerId: string,
    cursorRaw?: string,
    limitRaw?: number,
  ): Promise<{
    items: ServiceOfferingResponseDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = savePageLimit(limitRaw);
    const cursor = decodeSaveCursor(cursorRaw);
    const rows = await this.offerings.listSavedServices(
      viewerId,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const items = await Promise.all(
      page.map(async (row) => {
        const dto = await this.mapOne(row.service);
        dto.isSaved = true;
        dto.savedAt = row.createdAt.toISOString();
        const owner = (
          row.service as {
            user?: {
              displayName: string;
              username: string;
              isVerified: boolean;
              profile: { avatarUrl: string | null } | null;
            };
          }
        ).user;
        if (owner) {
          dto.ownerDisplayName = owner.displayName;
          dto.ownerUsername = owner.username;
          dto.ownerAvatarUrl = owner.profile?.avatarUrl ?? null;
          dto.ownerIsVerified = owner.isVerified;
        }
        return dto;
      }),
    );
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeSaveCursor(last.createdAt, last.serviceId)
          : null,
      hasMore,
    };
  }

  async create(
    userId: string,
    dto: CreateServiceOfferingDto,
  ): Promise<ServiceOfferingResponseDto> {
    this.assertPackages(dto.packages.map((p) => p.tier));
    const mediaIds = dto.media.map((m) => m.mediaAssetId);
    const assets = await this.mediaService.requireReadyOwnedAssets(
      userId,
      mediaIds,
    );
    const byId = new Map(assets.map((a) => [a.id, a]));
    const count = await this.offerings.countByUser(userId);
    const currency = await this.currencyForOwner(userId);

    const created = await this.offerings.create({
      id: randomUUID(),
      userId,
      title: dto.title.trim(),
      description: (dto.description ?? '').trim(),
      categoryId: dto.categoryId,
      customCategory: dto.customCategory,
      skillIds: dto.skillIds ?? [],
      position: count,
      currency,
      packages: dto.packages.map((p) => ({
        tier: p.tier,
        price: p.price,
        currency,
        deliveryLabel: p.deliveryLabel.trim(),
        includes: p.includes.map((i) => i.trim()).filter(Boolean),
      })),
      addons: (dto.addons ?? []).map((a, position) => ({
        title: a.title.trim(),
        price: a.price,
        currency,
        position,
      })),
      media: mediaIds.map((mediaAssetId, position) => ({
        mediaAssetId,
        position,
        isVideo: isVideoMime(byId.get(mediaAssetId)!.mimeType),
      })),
    });
    return this.mapOne(created);
  }

  async update(
    userId: string,
    offeringId: string,
    dto: UpdateServiceOfferingDto,
  ): Promise<ServiceOfferingResponseDto> {
    const existing = await this.offerings.findById(offeringId);
    if (!existing) {
      throw new NotFoundException('Service offering not found');
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException('You do not own this service');
    }
    if (dto.packages) {
      this.assertPackages(dto.packages.map((p) => p.tier));
    }

    let media:
      | Array<{ mediaAssetId: string; position: number; isVideo: boolean }>
      | undefined;
    if (dto.media) {
      const mediaIds = dto.media.map((m) => m.mediaAssetId);
      const assets = await this.mediaService.requireReadyOwnedAssets(
        userId,
        mediaIds,
      );
      const byId = new Map(assets.map((a) => [a.id, a]));
      media = mediaIds.map((mediaAssetId, position) => ({
        mediaAssetId,
        position,
        isVideo: isVideoMime(byId.get(mediaAssetId)!.mimeType),
      }));
    }

    // Keep the offering's snapshotted currency on package/addon edits.
    // Country/default-currency changes must never rewrite published offerings.
    const currency = existing.currency || DEFAULT_CURRENCY;

    const updated = await this.offerings.update(offeringId, userId, {
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      categoryId: dto.categoryId,
      customCategory: dto.customCategory,
      skillIds: dto.skillIds,
      packages: dto.packages?.map((p) => ({
        tier: p.tier,
        price: p.price,
        currency,
        deliveryLabel: p.deliveryLabel.trim(),
        includes: p.includes.map((i) => i.trim()).filter(Boolean),
      })),
      addons: dto.addons?.map((a, position) => ({
        title: a.title.trim(),
        price: a.price,
        currency,
        position,
      })),
      media,
    });
    return this.mapOne(updated);
  }

  async remove(userId: string, offeringId: string): Promise<void> {
    await this.offerings.softDelete(offeringId, userId);
  }

  async reorder(
    userId: string,
    dto: ReorderServicesDto,
  ): Promise<ServiceOfferingResponseDto[]> {
    const existing = await this.offerings.listByUser(userId);
    const existingIds = new Set(existing.map((o) => o.id));
    if (
      dto.serviceIds.length !== existing.length ||
      dto.serviceIds.some((id) => !existingIds.has(id))
    ) {
      throw new ForbiddenException(
        'serviceIds must include each of your services exactly once',
      );
    }
    await this.offerings.reorder(userId, dto.serviceIds);
    return this.listMine(userId);
  }

  private async currencyForOwner(userId: string): Promise<string> {
    const user = await this.users.findById(userId);
    const country = normalizeCountryCode(user?.profile?.countryCode);
    return country ? currencyForCountry(country) : DEFAULT_CURRENCY;
  }

  private assertPackages(tiers: PackageTier[]) {
    if (!tiers.includes(PackageTier.basic)) {
      throw new BadRequestException('Basic package is required');
    }
    if (new Set(tiers).size !== tiers.length) {
      throw new BadRequestException('Duplicate package tiers are not allowed');
    }
  }

  private async withSavedFlags(
    viewerId: string,
    rows: ServiceOfferingWithDetails[],
  ): Promise<ServiceOfferingResponseDto[]> {
    const [items, savedIds] = await Promise.all([
      this.mapMany(rows),
      this.offerings.listServiceSaveIds(
        viewerId,
        rows.map((row) => row.id),
      ),
    ]);
    const saved = new Set(savedIds);
    return items.map((item) => {
      item.isSaved = saved.has(item.id);
      return item;
    });
  }

  async listReviews(serviceId: string, query: ListServiceReviewsQueryDto) {
    const asOf = this.reviewClock.now();
    const page = await this.reviews.listForService({
      serviceId,
      cursor: query.cursor,
      limit: query.limit,
      asOf,
    });
    const items = await Promise.all(
      page.items.map(async (item) => ({
        id: item.id,
        contextLabel: this.reviews.contextLabel(item),
        rating: item.rating,
        body: item.body,
        createdAt: item.createdAt.toISOString(),
        reviewer: {
          id: item.reviewer.id,
          displayName: item.reviewer.displayName,
          username: item.reviewer.username,
          isVerified: item.reviewer.isVerified,
          avatarUrl: item.reviewer.profile?.avatarUrl ?? null,
          title: item.reviewer.profile?.title ?? null,
        },
        media: await Promise.all(
          item.media.map(async (media) => ({
            id: media.id,
            mimeType: media.mediaAsset.mimeType,
            url: await this.mediaService.getSignedUrlForAsset(media.mediaAssetId),
          })),
        ),
      })),
    );
    return { items, nextCursor: page.nextCursor };
  }

  private async mapMany(
    rows: ServiceOfferingWithDetails[],
  ): Promise<ServiceOfferingResponseDto[]> {
    const summaries = await this.reviews.summarizeServices(
      rows.map((row) => row.id),
      this.reviewClock.now(),
    );
    return Promise.all(
      rows.map((row) =>
        this.mapOne(row, summaries.get(row.id) ?? EMPTY_AGGREGATE),
      ),
    );
  }

  private async mapOne(
    offering: ServiceOfferingWithDetails,
    reviewSummary = EMPTY_AGGREGATE,
  ): Promise<ServiceOfferingResponseDto> {
    const urlsByAssetId = new Map<string, string | null>();
    await Promise.all(
      offering.media.map(async (m) => {
        const url = await this.mediaService.resolveUrlForAsset(m.mediaAsset);
        urlsByAssetId.set(m.mediaAssetId, url);
      }),
    );
    return ServiceOfferingResponseDto.fromEntity(
      offering,
      urlsByAssetId,
      reviewSummary,
    );
  }
}
