import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PackageTier } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  currencyForCountry,
  DEFAULT_CURRENCY,
  normalizeCountryCode,
} from '../../common/location/geo';
import { MediaService } from '../media/media.service';
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
  ) {}

  async listMine(userId: string): Promise<ServiceOfferingResponseDto[]> {
    const rows = await this.offerings.listByUser(userId);
    return this.mapMany(rows);
  }

  async listByUser(userId: string): Promise<ServiceOfferingResponseDto[]> {
    const rows = await this.offerings.listByUser(userId, {
      publishedOnly: true,
    });
    return this.mapMany(rows);
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
      category: dto.category?.trim() || null,
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
    const currency = existing.currency || DEFAULT_CURRENCY;

    const updated = await this.offerings.update(offeringId, userId, {
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      category:
        dto.category === undefined ? undefined : dto.category?.trim() || null,
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

  private async mapMany(
    rows: ServiceOfferingWithDetails[],
  ): Promise<ServiceOfferingResponseDto[]> {
    return Promise.all(rows.map((r) => this.mapOne(r)));
  }

  private async mapOne(
    offering: ServiceOfferingWithDetails,
  ): Promise<ServiceOfferingResponseDto> {
    const urlsByAssetId = new Map<string, string | null>();
    await Promise.all(
      offering.media.map(async (m) => {
        const url = await this.mediaService.resolveUrlForAsset(m.mediaAsset);
        urlsByAssetId.set(m.mediaAssetId, url);
      }),
    );
    return ServiceOfferingResponseDto.fromEntity(offering, urlsByAssetId);
  }
}
