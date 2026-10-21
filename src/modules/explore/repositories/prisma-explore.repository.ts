import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  businessOrder,
  serviceOrder,
  serviceWhere,
  talentOrder,
  talentWhere,
} from '../explore-sql';
import {
  EXPLORE_BUSINESS_MATCH_LIMIT,
  type ExploreRepository,
  type ExploreServiceFilter,
  type ExploreServiceRecord,
  type ExploreTalentFilter,
  type ExploreUserRecord,
} from './explore.repository';

const userInclude = {
  profile: true,
  skills: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.UserInclude;

const serviceInclude = {
  packages: true,
  media: {
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
  user: { include: userInclude },
} satisfies Prisma.ServiceOfferingInclude;

@Injectable()
export class PrismaExploreRepository implements ExploreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async searchTalents(
    filter: ExploreTalentFilter,
  ): Promise<{ ids: string[]; total: number }> {
    const where = talentWhere({
      viewerId: filter.viewerId,
      accountType: 'talent',
      q: filter.q,
      locationCode: filter.locationCode,
      includeSkillsAndServices: true,
      categoryIds: filter.categoryIds,
      searchSkillIds: filter.searchSkillIds,
    });
    const order = talentOrder({ sort: filter.sort, q: filter.q });
    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT u.id
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ${filter.take} OFFSET ${filter.skip}
      `,
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE ${where}
      `,
    ]);
    return {
      ids: rows.map((row) => row.id),
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async searchBusinesses(
    filter: ExploreTalentFilter,
  ): Promise<ExploreUserRecord[]> {
    const q = filter.q?.trim();
    if (!q) return [];
    // Name, username, and title only. Resolved skill ids never enter this clause.
    const where = talentWhere({
      viewerId: filter.viewerId,
      accountType: 'business',
      q,
      locationCode: filter.locationCode,
      includeSkillsAndServices: false,
    });
    const order = businessOrder(q);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT u.id
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${EXPLORE_BUSINESS_MATCH_LIMIT}
    `;
    return this.loadUsers(rows.map((row) => row.id));
  }

  async loadUsers(ids: string[]): Promise<ExploreUserRecord[]> {
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: userInclude,
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return ids.flatMap((id) => {
      const user = byId.get(id);
      return user ? [user] : [];
    });
  }

  async searchServices(
    filter: ExploreServiceFilter,
  ): Promise<{ ids: string[]; total: number }> {
    const where = serviceWhere(filter);
    const order = serviceOrder(filter.q);
    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT so.id
        FROM service_offerings so
        JOIN users u ON u.id = so.user_id
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ${filter.take} OFFSET ${filter.skip}
      `,
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM service_offerings so
        JOIN users u ON u.id = so.user_id
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE ${where}
      `,
    ]);
    return {
      ids: rows.map((row) => row.id),
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async loadServices(ids: string[]): Promise<ExploreServiceRecord[]> {
    if (ids.length === 0) return [];
    const offerings = await this.prisma.serviceOffering.findMany({
      where: { id: { in: ids }, deletedAt: null, status: 'published' },
      include: serviceInclude,
    });
    const byId = new Map(offerings.map((offering) => [offering.id, offering]));
    return ids.flatMap((id) => {
      const offering = byId.get(id);
      return offering ? [offering] : [];
    });
  }
}
