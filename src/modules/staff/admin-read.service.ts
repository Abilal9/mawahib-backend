import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MediaService } from '../media/media.service';
import {
  toApplicationDetail,
  toApplicationList,
  toEngagementDetail,
  toEngagementList,
  toJobDetail,
  toJobList,
  toServiceDetail,
  toServiceList,
  type StaffApplicationDetail,
  type StaffApplicationListItem,
  type StaffEngagementDetail,
  type StaffEngagementListItem,
  type StaffJobDetail,
  type StaffJobListItem,
  type StaffServiceDetail,
  type StaffServiceListItem,
  type StaffUserDetail,
  type StaffUserSummary,
} from './admin-read.mapper';
import {
  applicationBaseWhere,
  applicationIsNarrow,
  applicationListQuery,
  applicationWhere,
  createdPageWhere,
  decodeCursor,
  encodeCursor,
  engagementBaseWhere,
  engagementIsNarrow,
  engagementListQuery,
  engagementWhere,
  jobBaseWhere,
  jobIsNarrow,
  jobListQuery,
  jobWhere,
  optionalCursor,
  optionalLookup,
  parsePageLimit,
  paymentSummaryQuery,
  serviceBaseWhere,
  serviceIsNarrow,
  serviceListQuery,
  serviceWhere,
  userFilter,
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

@Injectable()
export class AdminReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly media?: MediaService,
  ) {}

  async searchUsers(query: Record<string, unknown>): Promise<{
    items: StaffUserSummary[]
    nextCursor: string | null
    totalUsers: number
    matchCount: number
  }> {
    const lookup = optionalLookup(query.q)
    const limit = parsePageLimit(query.limit)
    const cursor = decodeCursor(optionalCursor(query.cursor))
    const filter = userFilter(lookup)
    const [rows, matchCount, totalUsers] = await Promise.all([
      this.prisma.user.findMany({
        where: userPageWhere(lookup, cursor),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: userSummarySelect,
      }),
      this.prisma.user.count({ where: filter }),
      lookup ? this.prisma.user.count({ where: { deletedAt: null } }) : Promise.resolve(null),
    ])
    return {
      ...page(
        rows.map(toUserSummary),
        limit,
        (row) => ({ at: row.createdAt, id: row.id }),
      ),
      // Pages are separate requests. A later page can change if accounts are added or removed.
      totalUsers: totalUsers ?? matchCount,
      matchCount,
    }
  }

  async userDetail(
    id: string,
    actor: { issuer: string; subjectId: string },
  ): Promise<StaffUserDetail> {
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
    const selfLink = await this.prisma.staffMember.findFirst({
      where: {
        issuer: actor.issuer,
        subjectId: actor.subjectId,
        linkedProductUserId: id,
      },
      select: { id: true },
    });
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
      statusAction: row.deletedAt
        ? 'deleted'
        : selfLink
          ? 'ineligible'
          : row.accountStatus === 'SUSPENDED'
            ? 'restore'
            : 'suspend',
    };
  }

  async listJobs(query: Record<string, unknown>) {
    return this.listResource(
      jobListQuery(query),
      jobWhere,
      jobBaseWhere,
      jobIsNarrow,
      (where, take) =>
        this.prisma.jobListing.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: jobSelect,
        }),
      (where) => this.prisma.jobListing.count({ where }),
      toJobList,
    );
  }

  async jobDetail(id: string): Promise<StaffJobDetail> {
    const row = await this.prisma.jobListing.findUnique({
      where: { id },
      select: jobDetailSelect,
    });
    if (!row) throw new NotFoundException('Job not found.');
    return toJobDetail(row);
  }

  async listServices(query: Record<string, unknown>) {
    return this.listResource(
      serviceListQuery(query),
      serviceWhere,
      serviceBaseWhere,
      serviceIsNarrow,
      (where, take) =>
        this.prisma.serviceOffering.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: serviceSelect,
        }),
      (where) => this.prisma.serviceOffering.count({ where }),
      toServiceList,
    );
  }

  async serviceDetail(id: string): Promise<StaffServiceDetail> {
    const row = await this.prisma.serviceOffering.findUnique({
      where: { id },
      select: serviceSelect,
    });
    if (!row) throw new NotFoundException('Service not found.');
    return toServiceDetail(row);
  }

  async listApplications(query: Record<string, unknown>) {
    return this.listResource(
      applicationListQuery(query),
      applicationWhere,
      applicationBaseWhere,
      applicationIsNarrow,
      (where, take) =>
        this.prisma.jobApplication.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: applicationSelect,
        }),
      (where) => this.prisma.jobApplication.count({ where }),
      toApplicationList,
    );
  }

  async applicationDetail(id: string): Promise<StaffApplicationDetail> {
    const row = await this.prisma.jobApplication.findUnique({
      where: { id },
      select: applicationSelect,
    });
    if (!row) throw new NotFoundException('Application not found.');
    return toApplicationDetail(row);
  }

  async listEngagements(query: Record<string, unknown>) {
    return this.listResource(
      engagementListQuery(query),
      engagementWhere,
      engagementBaseWhere,
      engagementIsNarrow,
      (where, take) =>
        this.prisma.workEngagement.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: engagementSelect,
        }),
      (where) => this.prisma.workEngagement.count({ where }),
      toEngagementList,
    );
  }

  async engagementDetail(id: string): Promise<StaffEngagementDetail> {
    const row = await this.prisma.workEngagement.findUnique({
      where: { id },
      select: engagementDetailSelect,
    });
    if (!row) throw new NotFoundException('Engagement not found.');
    return toEngagementDetail(row);
  }

  async invoiceDocument(id: string): Promise<{
    url: string;
    originalFileName: string;
    mimeType: 'application/pdf';
  }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: {
        status: true,
        invoiceNumber: true,
        originalFileName: true,
        documentMediaAssetId: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (
      invoice.status !== 'generated' ||
      !invoice.documentMediaAssetId ||
      !this.media
    ) {
      throw new ConflictException('Invoice document is not ready yet.');
    }
    const url = await this.media.getSignedUrlForAsset(invoice.documentMediaAssetId);
    if (!url) throw new NotFoundException('Invoice document is not available.');
    return {
      url,
      originalFileName:
        invoice.originalFileName ?? `Mawahib-Invoice-${invoice.invoiceNumber}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  async marketplaceSummary(): Promise<{ totalJobs: number; totalEngagements: number }> {
    const [totalJobs, totalEngagements] = await Promise.all([
      this.prisma.jobListing.count({ where: { deletedAt: null } }),
      this.prisma.workEngagement.count({ where: { deletedAt: null } }),
    ]);
    return { totalJobs, totalEngagements };
  }

  private async listResource<TQuery extends { limit: number; cursor: PageCursor | null; includeDeleted: boolean }, TRow extends { id: string; createdAt: Date }, TItem extends { id: string; createdAt: string }>(
    parsed: TQuery,
    matchWhere: (input: TQuery) => object,
    baseWhere: (includeDeleted: boolean) => object,
    narrow: (input: TQuery) => boolean,
    findMany: (where: object, take: number) => Promise<TRow[]>,
    count: (where: object) => Promise<number>,
    map: (row: TRow) => TItem,
  ): Promise<{ items: TItem[]; nextCursor: string | null; total: number; matchCount: number }> {
    const where = createdPageWhere(matchWhere(parsed) as Record<string, unknown>, parsed.cursor);
    const match = matchWhere(parsed);
    const [rows, matchCount, baseCount] = await Promise.all([
      findMany(where, parsed.limit + 1),
      count(match),
      narrow(parsed) ? count(baseWhere(parsed.includeDeleted)) : Promise.resolve(null),
    ]);
    return {
      ...page(rows.map(map), parsed.limit, (row) => ({ at: row.createdAt, id: row.id })),
      total: baseCount ?? matchCount,
      matchCount,
    };
  }
}

const marketplaceParty = {
  select: { id: true, displayName: true, deletedAt: true },
};

const jobSelect = {
  id: true,
  title: true,
  companyName: true,
  status: true,
  employmentType: true,
  poster: marketplaceParty,
  postedAt: true,
  createdAt: true,
  deletedAt: true,
  location: true,
  updatedAt: true,
  customCategory: true,
  pricingType: true,
  currency: true,
  fixedAmount: true,
  minAmount: true,
  maxAmount: true,
  taxonomyCategory: { select: { id: true, nameEn: true } },
  _count: {
    select: {
      applications: { where: { deletedAt: null } },
      engagements: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.JobListingSelect;

const serviceSelect = {
  id: true,
  title: true,
  status: true,
  user: marketplaceParty,
  currency: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  customCategory: true,
  taxonomyCategory: { select: { id: true, nameEn: true } },
  packages: {
    select: { id: true, tier: true, price: true, currency: true, deliveryLabel: true },
  },
  _count: { select: { engagements: { where: { deletedAt: null } } } },
} satisfies Prisma.ServiceOfferingSelect;

const applicationSelect = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      poster: marketplaceParty,
    },
  },
  applicant: marketplaceParty,
  engagement: { select: { id: true, status: true, deletedAt: true } },
} satisfies Prisma.JobApplicationSelect;

const engagementSelect = {
  id: true,
  title: true,
  status: true,
  source: true,
  client: marketplaceParty,
  provider: marketplaceParty,
  listingId: true,
  applicationId: true,
  serviceOfferingId: true,
  payments: paymentSummaryQuery,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  deletedAt: true,
  dueAt: true,
  reviewWindowClosesAt: true,
  listing: { select: { id: true, title: true, deletedAt: true } },
  serviceOffering: { select: { id: true, title: true, deletedAt: true } },
} satisfies Prisma.WorkEngagementSelect;

const invoiceSummarySelect = {
  id: true,
  invoiceNumber: true,
  status: true,
  currency: true,
  total: true,
  provider: true,
  issuedAt: true,
  documentMediaAssetId: true,
} satisfies Prisma.InvoiceSelect;

const paymentAttemptSelect = {
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  select: {
    id: true,
    amount: true,
    currency: true,
    status: true,
    provider: true,
    createdAt: true,
    invoice: { select: invoiceSummarySelect },
  },
};

const engagementDetailSelect = {
  ...engagementSelect,
  payments: paymentAttemptSelect,
  disputeCases: {
    where: { isLatest: true },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.WorkEngagementSelect;

const jobDetailSelect = {
  ...jobSelect,
  engagements: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      client: marketplaceParty,
      provider: marketplaceParty,
      payments: paymentAttemptSelect,
    },
  },
} satisfies Prisma.JobListingSelect;

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
