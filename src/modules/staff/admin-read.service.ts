import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  toDispute,
  type StaffDispute,
  type StaffUserDetail,
  type StaffUserSummary,
} from './admin-read.mapper';
import {
  decodeCursor,
  disputeEventQuery,
  disputePageWhere,
  encodeCursor,
  optionalCursor,
  parsePageLimit,
  paymentSummaryQuery,
  requireLookup,
  userPageWhere,
  type PageCursor,
} from './admin-read.query';

const userSummarySelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  accountType: true,
  accountStatus: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

const partySelect = { select: { displayName: true } };

@Injectable()
export class AdminReadService {
  constructor(private readonly prisma: PrismaService) {}

  async searchUsers(query: Record<string, unknown>): Promise<{
    items: StaffUserSummary[];
    nextCursor: string | null;
  }> {
    const lookup = requireLookup(query.q);
    const limit = parsePageLimit(query.limit);
    const cursor = decodeCursor(optionalCursor(query.cursor));
    const rows = await this.prisma.user.findMany({
      where: userPageWhere(lookup, cursor),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: userSummarySelect,
    });
    return page(
      rows.map(toUserSummary),
      limit,
      (row) => ({ at: row.createdAt, id: row.id }),
    );
  }

  async userDetail(id: string): Promise<StaffUserDetail> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userSummarySelect,
        followersCount: true,
        followingCount: true,
        postsCount: true,
        _count: {
          select: {
            engagementsAsClient: true,
            engagementsAsProvider: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('User not found.');
    const simulatedPaymentCount = await this.prisma.payment.count({
      where: {
        provider: 'mock',
        OR: [{ payerUserId: id }, { payeeUserId: id }],
      },
    });
    return {
      ...toUserSummary(row),
      followersCount: row.followersCount,
      followingCount: row.followingCount,
      postsCount: row.postsCount,
      clientEngagementCount: row._count.engagementsAsClient,
      providerEngagementCount: row._count.engagementsAsProvider,
      simulatedPaymentCount,
    };
  }

  async listDisputes(query: Record<string, unknown>): Promise<{
    items: StaffDispute[];
    nextCursor: string | null;
  }> {
    const limit = parsePageLimit(query.limit);
    const cursor = decodeCursor(optionalCursor(query.cursor));
    const rows = await this.prisma.workEngagement.findMany({
      where: disputePageWhere(cursor),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: disputeSelect,
    });
    return page(
      rows.map(toDispute),
      limit,
      (row) => ({ at: row.updatedAt, id: row.id }),
    );
  }

  async disputeDetail(id: string): Promise<StaffDispute> {
    const row = await this.prisma.workEngagement.findFirst({
      where: { id, status: 'disputed' },
      select: disputeSelect,
    });
    if (!row) throw new NotFoundException('Dispute not found.');
    return toDispute(row);
  }
}

const disputeSelect = {
  id: true,
  title: true,
  updatedAt: true,
  deletedAt: true,
  client: partySelect,
  provider: partySelect,
  events: disputeEventQuery,
  payments: paymentSummaryQuery,
} satisfies Prisma.WorkEngagementSelect;

function toUserSummary(row: {
  id: string;
  email: string;
  username: string;
  displayName: string;
  accountType: string;
  accountStatus: string;
  createdAt: Date;
  deletedAt: Date | null;
}): StaffUserSummary {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    accountType: row.accountType,
    accountStatus: row.accountStatus,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function page<T extends { id: string }>(
  rows: T[],
  limit: number,
  cursorFor: (row: T) => PageCursor,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(cursorFor(last)) : null,
  };
}
