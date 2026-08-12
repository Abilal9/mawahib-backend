import { Injectable } from '@nestjs/common';
import {
  AccountType,
  PackageTier,
  ServiceOfferingStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MediaService } from '../media/media.service';

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
  price: number;
  currency: string;
  duration: string;
  rating: number;
  reviewCount: number;
  images: string[];
  exploreTag: string | null;
  provider: ExploreProfileDto;
};

@Injectable()
export class ExploreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async listProfiles(accountType: AccountType): Promise<ExploreProfileDto[]> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, accountType },
      include: { profile: true, skills: true },
      orderBy: [{ followersCount: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return users.map((u) => this.mapProfile(u));
  }

  async listPublishedServices(): Promise<ExploreServiceDto[]> {
    const offerings = await this.prisma.serviceOffering.findMany({
      where: {
        deletedAt: null,
        status: ServiceOfferingStatus.published,
      },
      include: {
        packages: true,
        media: {
          include: { mediaAsset: true },
          orderBy: { position: 'asc' },
        },
        user: { include: { profile: true, skills: true } },
      },
      orderBy: [{ ratingAvg: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const mapped: ExploreServiceDto[] = [];
    for (const o of offerings) {
      const basic =
        o.packages.find((p) => p.tier === PackageTier.basic) ?? o.packages[0];
      const images: string[] = [];
      for (const m of o.media) {
        const url = await this.mediaService.resolveUrlForAsset(m.mediaAsset);
        if (url) images.push(url);
      }
      mapped.push({
        id: o.id,
        title: o.title,
        description: o.description,
        category: o.category,
        price: Number(basic?.price ?? 0),
        currency: o.currency,
        duration: basic?.deliveryLabel ?? '',
        rating: Number(o.ratingAvg),
        reviewCount: o.ratingCount,
        images,
        exploreTag: o.category,
        provider: this.mapProfile(o.user),
      });
    }
    return mapped;
  }

  private mapProfile(user: {
    id: string;
    displayName: string;
    username: string;
    accountType: AccountType;
    isVerified: boolean;
    followersCount: number;
    followingCount: number;
    postsCount: number;
    ratingAvg: { toString(): string } | number;
    ratingCount: number;
    profile: {
      bio: string;
      title: string | null;
      locationCity: string | null;
      locationCountry: string | null;
      avatarUrl: string | null;
      coverUrl: string | null;
    } | null;
    skills: Array<{ skill: string }>;
  }): ExploreProfileDto {
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
      skills: user.skills.map((s) => s.skill),
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      postsCount: user.postsCount,
      ratingAvg: Number(user.ratingAvg),
      ratingCount: user.ratingCount,
    };
  }
}
