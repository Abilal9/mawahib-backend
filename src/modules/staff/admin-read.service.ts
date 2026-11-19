import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MediaService } from '../media/media.service';
import { staffClosurePaymentRefusal, unpaidCancellationRefusal } from './staff-closure';
import { parseGrowthPeriod, riyadhGrowthWindow, type GrowthPeriodDays } from './growth-window';
import { auditActionLabel, auditActor, auditTarget } from './staff-audit';
import {
  publicJobWhere,
  publicPostWhere,
  publicServiceWhere,
  retainedAccountWhere,
  retainedEngagementWhere,
  staffHiddenJobWhere,
  staffHiddenServiceWhere,
} from '../public/public-visibility';
import {
  toApplicationDetail,
  toApplicationList,
  toEngagementDetail,
  toEngagementList,
  toFollowUpRecord,
  toJobDetail,
  toJobList,
  toPaymentLedger,
  toServiceDetail,
  toServiceList,
  closureView,
  type StaffApplicationDetail,
  type StaffApplicationListItem,
  type StaffEngagementDetail,
  type StaffEngagementListItem,
  type StaffFollowUpRecord,
  type StaffJobDetail,
  type StaffJobListItem,
  type StaffPaymentLedgerItem,
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
  followUpBaseWhere,
  followUpListQuery,
  followUpWhere,
  jobBaseWhere,
  jobIsNarrow,
  jobListQuery,
  jobWhere,
  optionalCursor,
  optionalLookup,
  parsePageLimit,
  paymentListQuery,
  paymentSummaryQuery,
  paymentWhere,
  serviceBaseWhere,
  serviceIsNarrow,
  serviceListQuery,
  serviceWhere,
  staffAuditQuery,
  staffAuditWhere,
  staffDirectoryQuery,
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

  async engagementDetail(
    id: string,
    actor?: { issuer: string; sub: string },
  ): Promise<StaffEngagementDetail> {
    const row = await this.prisma.workEngagement.findUnique({
      where: { id },
      select: engagementDetailSelect,
    });
    if (!row) throw new NotFoundException('Engagement not found.');
    const closure = await this.prisma.engagementStaffClosure.findUnique({
      where: { engagementId: id },
      include: {
        closedBy: { select: { invitedEmail: true } },
        followUpRecorder: { select: { invitedEmail: true } },
      },
    });
    const reason = closure
      ? (await this.prisma.staffAuditEvent.findFirst({
          where: { action: 'staff_work_closed', targetSubjectId: id },
          orderBy: { createdAt: 'desc' },
          select: { reason: true },
        }))?.reason ?? null
      : null;
    const latest = row.disputeCases[0];
    const open = latest && (latest.status === 'open' || latest.status === 'in_review');
    const unpaid = await this.prisma.staffUnpaidCancellation.findUnique({
      where: { engagementId: id },
      select: { id: true },
    });
    const cancelUnpaid = await this.cancelUnpaidView(row, actor, Boolean(open));
    const closable = row.status === 'in_progress' || row.status === 'delivered' || row.status === 'disputed';
    const paymentBlock = staffClosurePaymentRefusal(row.payments.map((payment) => ({
      status: payment.status,
      provider: payment.provider,
    })));
    return toEngagementDetail(row, {
      staffClosure: closureView(row.staffClosedAt, closure, reason),
      cancelledByMawahib: unpaid != null,
      cancelUnpaid,
      closeWork: {
        route: row.deletedAt || row.staffClosedAt || !closable || paymentBlock
          ? null
          : open
            ? 'dispute_case'
            : 'engagement',
        openCaseId: open ? latest.id : null,
        blockedReason: row.deletedAt ? 'This engagement is deleted.' : paymentBlock,
      },
    });
  }

  private async cancelUnpaidView(
    row: {
      status: string;
      deletedAt: Date | null;
      client: { id: string } | null;
      provider: { id: string } | null;
      payments: Array<{ status: string; provider: string; providerReference: string | null }>;
      disputeCases: Array<{ status: string; assigneeStaffMemberId: string | null }>;
    },
    actor: { issuer: string; sub: string } | undefined,
    open: boolean,
  ): Promise<StaffEngagementDetail['cancelUnpaid']> {
    if (row.deletedAt) return { available: false, blockedReason: 'This engagement is deleted.' };
    if (row.status !== 'pending_payment') return { available: false, blockedReason: null };
    const paymentBlock = unpaidCancellationRefusal(row.payments.map((payment) => ({
      status: payment.status,
      provider: payment.provider,
      providerReference: payment.providerReference,
    })));
    if (paymentBlock) return { available: false, blockedReason: paymentBlock };
    if (!actor?.issuer || !actor.sub) return { available: false, blockedReason: 'Staff access is required.' };
    const staff = await this.prisma.staffMember.findUnique({
      where: { issuer_subjectId: { issuer: actor.issuer, subjectId: actor.sub } },
      select: { id: true, status: true, role: true, linkedProductUserId: true },
    });
    if (!staff || staff.status !== 'active' || staff.role !== 'operator') {
      return { available: false, blockedReason: 'Staff access is required.' };
    }
    if (
      staff.linkedProductUserId
      && (staff.linkedProductUserId === row.client?.id || staff.linkedProductUserId === row.provider?.id)
    ) {
      return { available: false, blockedReason: 'An operator cannot cancel work they are part of.' };
    }
    const latest = row.disputeCases[0];
    if (open && latest && !latest.assigneeStaffMemberId) {
      return { available: false, blockedReason: 'Assign this case to a reviewer before handling it.' };
    }
    if (open && latest && latest.assigneeStaffMemberId !== staff.id) {
      return { available: false, blockedReason: 'Only the assigned reviewer can handle this case.' };
    }
    return { available: true, blockedReason: null };
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

  async listPayments(query: Record<string, unknown>): Promise<{
    items: StaffPaymentLedgerItem[];
    nextCursor: string | null;
    totalAttempts: number;
    matchCount: number;
  }> {
    const parsed = paymentListQuery(query);
    const match = paymentWhere(parsed);
    const where = createdPageWhere(match as Record<string, unknown>, parsed.cursor);
    const [rows, matchCount, totalAttempts] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: parsed.limit + 1,
        select: paymentLedgerSelect,
      }),
      this.prisma.payment.count({ where: match }),
      this.prisma.payment.count(),
    ]);
    const paged = page(rows, parsed.limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
    return {
      items: paged.items.map(toPaymentLedger),
      nextCursor: paged.nextCursor,
      totalAttempts,
      matchCount,
    };
  }

  async listFinancialFollowUps(query: Record<string, unknown>): Promise<{
    items: StaffFollowUpRecord[];
    nextCursor: string | null;
    totalRecords: number;
    matchCount: number;
  }> {
    const parsed = followUpListQuery(query);
    const match = followUpWhere(parsed);
    const where = createdPageWhere(match as Record<string, unknown>, parsed.cursor);
    const [rows, matchCount, totalRecords] = await Promise.all([
      this.prisma.engagementStaffClosure.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: parsed.limit + 1,
        select: followUpSelect,
      }),
      this.prisma.engagementStaffClosure.count({ where: match }),
      this.prisma.engagementStaffClosure.count({ where: followUpBaseWhere() }),
    ]);
    const paged = page(rows, parsed.limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
    return {
      items: paged.items.map(toFollowUpRecord),
      nextCursor: paged.nextCursor,
      totalRecords,
      matchCount,
    };
  }

  async listStaffDirectory(query: Record<string, unknown>) {
    const parsed = staffDirectoryQuery(query);
    const where = createdPageWhere({}, parsed.cursor);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.staffMember.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: parsed.limit + 1,
        select: {
          id: true,
          invitedEmail: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          linkedProductUser: { select: { id: true, displayName: true, deletedAt: true } },
        },
      }),
      this.prisma.staffMember.count(),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const paged = page(rows, parsed.limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
    return {
      items: paged.items.map((row) => ({
        id: row.id,
        invitedEmail: row.invitedEmail,
        role: row.role,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        linkedAccount: row.linkedProductUser
          ? {
              id: row.linkedProductUser.id,
              displayName: row.linkedProductUser.deletedAt ? 'Deleted user' : row.linkedProductUser.displayName,
              deleted: row.linkedProductUser.deletedAt != null,
            }
          : null,
      })),
      nextCursor: paged.nextCursor,
      total,
    };
  }

  async listStaffAudit(query: Record<string, unknown>) {
    const parsed = staffAuditQuery(query);
    const match = staffAuditWhere(parsed);
    const where = createdPageWhere(match as Record<string, unknown>, parsed.cursor);
    return this.prisma.$transaction(async (tx) => {
      const [rows, matchCount, total] = await Promise.all([
        tx.staffAuditEvent.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: parsed.limit + 1,
          select: staffAuditSelect,
        }),
        tx.staffAuditEvent.count({ where: match }),
        tx.staffAuditEvent.count(),
      ]);
      const paged = page(rows, parsed.limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
      const presence = await auditPresence(tx, paged.items);
      return {
        items: paged.items.map((row) => toAuditItem(row, presence)),
        nextCursor: paged.nextCursor,
        total,
        matchCount,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async growthSnapshot(periodValue: unknown, now = new Date()): Promise<{
    asOf: string;
    timeZone: 'Asia/Riyadh';
    periodDays: GrowthPeriodDays;
    periodStart: string;
    periodEnd: string;
    current: GrowthCounts & { staffHiddenJobs: number; staffHiddenServices: number };
    createdInPeriod: GrowthCounts;
  }> {
    let periodDays: GrowthPeriodDays;
    try {
      periodDays = parseGrowthPeriod(periodValue);
    } catch {
      throw new BadRequestException('Choose 7 or 30 days.');
    }
    const window = riyadhGrowthWindow(now, periodDays);
    const created = { gte: window.start, lte: window.end };
    const during = <T extends object>(where: T) => ({ AND: [where, { createdAt: created }] });
    const [
      accounts,
      publicJobs,
      publicServices,
      publicPosts,
      staffHiddenJobs,
      staffHiddenServices,
      engagements,
      periodAccounts,
      periodPublicJobs,
      periodPublicServices,
      periodPublicPosts,
      periodEngagements,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: retainedAccountWhere }),
      this.prisma.jobListing.count({ where: publicJobWhere }),
      this.prisma.serviceOffering.count({ where: publicServiceWhere }),
      this.prisma.post.count({ where: publicPostWhere }),
      this.prisma.jobListing.count({ where: staffHiddenJobWhere }),
      this.prisma.serviceOffering.count({ where: staffHiddenServiceWhere }),
      this.prisma.workEngagement.count({ where: retainedEngagementWhere }),
      this.prisma.user.count({ where: during(retainedAccountWhere) }),
      this.prisma.jobListing.count({ where: during(publicJobWhere) }),
      this.prisma.serviceOffering.count({ where: during(publicServiceWhere) }),
      this.prisma.post.count({ where: during(publicPostWhere) }),
      this.prisma.workEngagement.count({ where: during(retainedEngagementWhere) }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      asOf: now.toISOString(),
      timeZone: 'Asia/Riyadh',
      periodDays,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      current: {
        accounts,
        publicJobs,
        publicServices,
        publicPosts,
        staffHiddenJobs,
        staffHiddenServices,
        engagements,
      },
      createdInPeriod: {
        accounts: periodAccounts,
        publicJobs: periodPublicJobs,
        publicServices: periodPublicServices,
        publicPosts: periodPublicPosts,
        engagements: periodEngagements,
      },
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
  staffClosedAt: true,
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
  payerDisplayName: true,
  payeeDisplayName: true,
  description: true,
} satisfies Prisma.InvoiceSelect;

const paymentLedgerSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  provider: true,
  providerReference: true,
  createdAt: true,
  succeededAt: true,
  failedAt: true,
  payer: marketplaceParty,
  payee: marketplaceParty,
  engagement: {
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      staffClosedAt: true,
      staffUnpaidCancellation: { select: { id: true } },
    },
  },
  invoice: { select: invoiceSummarySelect },
} satisfies Prisma.PaymentSelect;

const followUpSelect = {
  id: true,
  followUpOutcome: true,
  followUpNote: true,
  followUpRecordedAt: true,
  createdAt: true,
  followUpRecorder: { select: { invitedEmail: true } },
  engagement: {
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      staffClosedAt: true,
      staffUnpaidCancellation: { select: { id: true } },
    },
  },
} satisfies Prisma.EngagementStaffClosureSelect;

const paymentAttemptSelect = {
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  select: {
    id: true,
    amount: true,
    currency: true,
    status: true,
    provider: true,
    providerReference: true,
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
    select: { id: true, status: true, assigneeStaffMemberId: true },
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

type GrowthCounts = {
  accounts: number;
  publicJobs: number;
  publicServices: number;
  publicPosts: number;
  engagements: number;
};

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

const staffAuditSelect = {
  id: true,
  action: true,
  reason: true,
  createdAt: true,
  unverifiedProcessUser: true,
  targetSubjectId: true,
  targetAccountId: true,
  targetReportId: true,
  targetPostId: true,
  targetCommentId: true,
  targetReviewId: true,
  targetJobListingId: true,
  targetServiceOfferingId: true,
  targetInvoiceId: true,
  actor: { select: { invitedEmail: true, status: true } },
} satisfies Prisma.StaffAuditEventSelect;

type AuditRow = Prisma.StaffAuditEventGetPayload<{ select: typeof staffAuditSelect }>;

function toAuditItem(row: AuditRow, presence: Map<string, 'retained' | 'deleted' | 'missing'>) {
  const target = auditTarget(row);
  const state = presence.get(`${target.kind}:${target.id}`) ?? (target.hasDetailScreen ? 'missing' : 'missing');
  return {
    id: row.id,
    action: row.action,
    actionLabel: auditActionLabel(row.action),
    createdAt: row.createdAt.toISOString(),
    actor: auditActor({
      actor: row.actor,
      commandRecorded: typeof row.unverifiedProcessUser === 'string' && row.unverifiedProcessUser.trim().length > 0,
    }),
    reason: row.reason,
    target: {
      kind: target.kind,
      id: target.id,
      hasDetailScreen: target.hasDetailScreen,
      presence: state,
    },
  };
}

async function auditPresence(prisma: Prisma.TransactionClient, rows: AuditRow[]) {
  const ids = (kind: ReturnType<typeof auditTarget>['kind']) =>
    [...new Set(rows.map(auditTarget).filter((item) => item.kind === kind).map((item) => item.id))];
  const lookup = async <T,>(values: string[], read: (values: string[]) => Promise<T[]>): Promise<T[]> =>
    values.length === 0 ? [] : read(values);
  const [accounts, reports, posts, comments, reviews, jobs, services, invoices, engagements, memberships] = await Promise.all([
    lookup(ids('account'), (values) => prisma.user.findMany({ where: { id: { in: values } }, select: { id: true, deletedAt: true } })),
    lookup(ids('report'), (values) => prisma.contentReport.findMany({ where: { id: { in: values } }, select: { id: true } })),
    lookup(ids('post'), (values) => prisma.post.findMany({ where: { id: { in: values } }, select: { id: true, deletedAt: true } })),
    lookup(ids('comment'), (values) => prisma.postComment.findMany({ where: { id: { in: values } }, select: { id: true, deletedAt: true } })),
    lookup(ids('review'), (values) => prisma.engagementReview.findMany({ where: { id: { in: values } }, select: { id: true } })),
    lookup(ids('job'), (values) => prisma.jobListing.findMany({ where: { id: { in: values } }, select: { id: true, deletedAt: true } })),
    lookup(ids('service'), (values) => prisma.serviceOffering.findMany({ where: { id: { in: values } }, select: { id: true, deletedAt: true } })),
    lookup(ids('invoice'), (values) => prisma.invoice.findMany({ where: { id: { in: values } }, select: { id: true } })),
    lookup(ids('engagement'), (values) => prisma.workEngagement.findMany({ where: { id: { in: values } }, select: { id: true, deletedAt: true } })),
    lookup(ids('staff_membership'), (values) => prisma.staffMember.findMany({ where: { subjectId: { in: values } }, select: { subjectId: true } })),
  ]);
  const found = new Map<string, 'retained' | 'deleted' | 'missing'>();
  const mark = (kind: string, id: string, state: 'retained' | 'deleted') => found.set(`${kind}:${id}`, state);
  for (const row of accounts) mark('account', row.id, row.deletedAt ? 'deleted' : 'retained');
  for (const row of reports) mark('report', row.id, 'retained');
  for (const row of posts) mark('post', row.id, row.deletedAt ? 'deleted' : 'retained');
  for (const row of comments) mark('comment', row.id, row.deletedAt ? 'deleted' : 'retained');
  for (const row of reviews) mark('review', row.id, 'retained');
  for (const row of jobs) mark('job', row.id, row.deletedAt ? 'deleted' : 'retained');
  for (const row of services) mark('service', row.id, row.deletedAt ? 'deleted' : 'retained');
  for (const row of invoices) mark('invoice', row.id, 'retained');
  for (const row of engagements) mark('engagement', row.id, row.deletedAt ? 'deleted' : 'retained');
  for (const row of memberships) mark('staff_membership', row.subjectId, 'retained');
  for (const row of rows) {
    const target = auditTarget(row);
    const key = `${target.kind}:${target.id}`;
    if (!found.has(key)) found.set(key, 'missing');
  }
  return found;
}
