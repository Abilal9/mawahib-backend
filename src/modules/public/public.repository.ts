import { Injectable } from '@nestjs/common';
import {
  JobListingStatus,
  MediaPurpose,
  MediaStatus,
  PostVisibility,
  Prisma,
  ServiceOfferingStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { talentOrder, serviceOrder } from '../explore/explore-sql';
import { overallUserRatingLateral, serviceRatingLateral } from '../reviews/review-sql';
import { discoverableUserWhere } from './discoverable-user';
import { publicServiceWhere, publicTalentWhere } from './public-explore-sql';

const discoverableAuthor = {
  ...discoverableUserWhere,
} as const;

function publicMediaWhere(purpose: MediaPurpose) {
  return {
    mediaAsset: {
      purpose,
      status: MediaStatus.ready,
      deletedAt: null,
    },
  };
}

const postInclude = {
  author: { include: { profile: true } },
  media: {
    where: publicMediaWhere(MediaPurpose.post),
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.PostInclude;

const listingInclude = {
  poster: {
    select: {
      id: true,
      displayName: true,
      username: true,
      accountType: true,
      profile: { select: { avatarUrl: true, title: true } },
    },
  },
  taxonomyCategory: { select: { id: true, nameEn: true } },
  taxonomySkills: {
    orderBy: { position: 'asc' as const },
    select: {
      position: true,
      skill: { select: { id: true, nameEn: true } },
    },
  },
} as const;

const serviceInclude = {
  packages: { orderBy: { tier: 'asc' as const } },
  addons: { orderBy: { position: 'asc' as const } },
  media: {
    where: publicMediaWhere(MediaPurpose.service),
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
  taxonomyCategory: { select: { id: true, nameEn: true } },
  taxonomySkills: {
    orderBy: { position: 'asc' as const },
    select: {
      position: true,
      skill: { select: { id: true, nameEn: true } },
    },
  },
  user: {
    include: {
      profile: true,
      skills: {
        orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
      },
    },
  },
} satisfies Prisma.ServiceOfferingInclude;

const userInclude = {
  profile: true,
  skills: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.UserInclude;

const portfolioInclude = {
  media: {
    where: publicMediaWhere(MediaPurpose.portfolio),
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.PortfolioProjectInclude;

function postCursorWhere(
  cursor: { createdAt: string; id: string } | null,
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
export class PublicRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDiscoverableUser(id: string) {
    return this.prisma.user.findFirst({
      where: { id, ...discoverableUserWhere },
      include: userInclude,
    });
  }

  listPublicFeed(input: {
    cursor: { createdAt: string; id: string } | null;
    take: number;
  }) {
    return this.prisma.post.findMany({
      where: {
        deletedAt: null,
        visibility: PostVisibility.public,
        author: discoverableAuthor,
        ...(postCursorWhere(input.cursor) ?? {}),
      },
      include: postInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.take,
    });
  }

  findPublicPost(id: string) {
    return this.prisma.post.findFirst({
      where: {
        id,
        deletedAt: null,
        visibility: PostVisibility.public,
        author: discoverableAuthor,
      },
      include: postInclude,
    });
  }

  listPublicUserPosts(input: {
    authorId: string;
    cursor: { createdAt: string; id: string } | null;
    take: number;
  }) {
    return this.prisma.post.findMany({
      where: {
        authorId: input.authorId,
        deletedAt: null,
        visibility: PostVisibility.public,
        author: discoverableAuthor,
        ...(postCursorWhere(input.cursor) ?? {}),
      },
      include: postInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.take,
    });
  }

  async countLikesForPosts(postIds: string[]) {
    if (postIds.length === 0) return [];
    const rows = await this.prisma.postLike.groupBy({
      by: ['postId'],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    });
    return rows.map((row) => ({ postId: row.postId, _count: row._count._all }));
  }

  async countCommentsForPosts(postIds: string[]) {
    if (postIds.length === 0) return [];
    const rows = await this.prisma.postComment.groupBy({
      by: ['postId'],
      where: { postId: { in: postIds }, deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ postId: row.postId, _count: row._count._all }));
  }

  listPublicUserServices(ownerId: string) {
    return this.prisma.serviceOffering.findMany({
      where: {
        userId: ownerId,
        deletedAt: null,
        status: ServiceOfferingStatus.published,
        user: discoverableAuthor,
      },
      include: serviceInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      take: 20,
    });
  }

  findPublicService(id: string) {
    return this.prisma.serviceOffering.findFirst({
      where: {
        id,
        deletedAt: null,
        status: ServiceOfferingStatus.published,
        user: discoverableAuthor,
      },
      include: serviceInclude,
    });
  }

  listPublicUserPortfolio(ownerId: string) {
    return this.prisma.portfolioProject.findMany({
      where: {
        userId: ownerId,
        deletedAt: null,
        user: discoverableAuthor,
      },
      include: portfolioInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      take: 20,
    });
  }

  listPublicOpenJobs(input: { take: number; skip: number; q?: string }) {
    const q = input.q?.trim();
    return this.prisma.jobListing.findMany({
      where: {
        deletedAt: null,
        status: JobListingStatus.open,
        poster: discoverableAuthor,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' as const } },
                { description: { contains: q, mode: 'insensitive' as const } },
                { companyName: { contains: q, mode: 'insensitive' as const } },
                { location: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: listingInclude,
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: input.take,
      skip: input.skip,
    });
  }

  findPublicOpenJob(id: string) {
    return this.prisma.jobListing.findFirst({
      where: {
        id,
        deletedAt: null,
        status: JobListingStatus.open,
        poster: discoverableAuthor,
      },
      include: listingInclude,
    });
  }

  async searchPublicTalents(input: {
    q?: string;
    searchSkillIds?: string[];
    take: number;
    skip: number;
    asOf: Date;
  }): Promise<string[]> {
    const where = publicTalentWhere({
      q: input.q,
      searchSkillIds: input.searchSkillIds,
    });
    const order = talentOrder({ sort: 'recommended', q: input.q });
    const ratingJoin = input.q?.trim()
      ? overallUserRatingLateral(input.asOf)
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT u.id
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      ${ratingJoin}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${input.take} OFFSET ${input.skip}
    `;
    return rows.map((row) => row.id);
  }

  async searchPublicServices(input: {
    q?: string;
    searchSkillIds?: string[];
    take: number;
    skip: number;
    asOf: Date;
  }): Promise<string[]> {
    const where = publicServiceWhere({
      q: input.q,
      searchSkillIds: input.searchSkillIds,
    });
    const order = serviceOrder(input.q);
    const ratingJoin = input.q?.trim()
      ? serviceRatingLateral(input.asOf)
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT so.id
      FROM service_offerings so
      JOIN users u ON u.id = so.user_id
      LEFT JOIN profiles p ON p.user_id = u.id
      ${ratingJoin}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${input.take} OFFSET ${input.skip}
    `;
    return rows.map((row) => row.id);
  }

  loadDiscoverableUsers(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: ids }, ...discoverableUserWhere },
      include: userInclude,
    });
  }

  loadPublicServices(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.serviceOffering.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: ServiceOfferingStatus.published,
        user: discoverableAuthor,
      },
      include: serviceInclude,
    });
  }
}

export type PublicUserRecord = Prisma.UserGetPayload<{
  include: typeof userInclude;
}>;

export type PublicPostRecord = Prisma.PostGetPayload<{
  include: typeof postInclude;
}>;

export type PublicServiceRecord = Prisma.ServiceOfferingGetPayload<{
  include: typeof serviceInclude;
}>;

export type PublicJobRecord = Prisma.JobListingGetPayload<{
  include: typeof listingInclude;
}>;

export type PublicPortfolioRecord = Prisma.PortfolioProjectGetPayload<{
  include: typeof portfolioInclude;
}>;
