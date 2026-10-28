import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  JobApplicationStatus,
  JobListingStatus,
  JobPricingType,
  Prisma,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestStatus,
  type EngagementReview,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { savedJobWhere } from '../saved-job.query';
import { resolveCanonicalTaxonomy } from '../../taxonomy/canonical-taxonomy';
import {
  resolveCustomCategory,
  taxonomyColumnPatch,
} from '../../taxonomy/custom-category';
import {
  DEFAULT_CURRENCY,
  businessTodayIso,
  formatDeadline,
  toJson,
  type WorkRequestTerms,
} from '../work-request-terms';
import {
  CALENDAR_SCHEDULED_LIMIT,
  CALENDAR_SCHEDULED_STATUSES,
  CALENDAR_UNSCHEDULED_LIMIT,
  CALENDAR_UNSCHEDULED_STATUSES,
  type CalendarScheduleQuery,
  type CalendarScheduleRow,
  type CalendarUnscheduledQuery,
  type CalendarUnscheduledRow,
  type EngagementScheduleStateRow,
} from '../calendar-read';
import {
  deadlineFromAgreedTerms,
  scheduleCreateData,
  scheduleFromAgreedDeadline,
  scheduleFromDuration,
} from '../engagement-schedule';
import type {
  CreateListingInput,
  CreateWorkRequestInput,
  JobApplicationWithRelations,
  JobListingWithPoster,
  ListListingsFilter,
  ListWorkRequestsFilter,
  MarketplaceRepository,
  ServiceOfferingSnapshot,
  UpdateListingInput,
  UserReviewWithRelations,
  WorkEngagementWithRelations,
  WorkRequestAttachmentWithMedia,
  WorkRequestEventInput,
  WorkRequestUnreadSummary,
  WorkRequestWithRelations,
} from './marketplace.repository';

const posterSelect = {
  id: true,
  displayName: true,
  username: true,
  accountType: true,
  isVerified: true,
  profile: { select: { avatarUrl: true } },
} as const;

const taxonomySkillInclude = {
  orderBy: { position: 'asc' as const },
  select: {
    position: true,
    skill: { select: { id: true, nameEn: true } },
  },
} as const;

const listingInclude = {
  poster: { select: posterSelect },
  taxonomyCategory: { select: { id: true, nameEn: true } },
  taxonomySkills: taxonomySkillInclude,
} as const;

const applicationListingInclude = {
  taxonomyCategory: { select: { id: true, nameEn: true } },
  taxonomySkills: taxonomySkillInclude,
} as const;

const partySelect = {
  id: true,
  displayName: true,
  username: true,
  isVerified: true,
  profile: { select: { avatarUrl: true, title: true } },
} as const;

/** Calendar counterpart. Profile title stays off this select. */
const calendarPartySelect = {
  id: true,
  displayName: true,
  username: true,
  isVerified: true,
  profile: { select: { avatarUrl: true } },
} as const;

const calendarEngagementSelect = {
  id: true,
  title: true,
  status: true,
  clientId: true,
  providerId: true,
  client: { select: calendarPartySelect },
  provider: { select: calendarPartySelect },
  workRequest: { select: { id: true, deletedAt: true } },
} as const;

const workRequestPartySelect = {
  ...partySelect,
  accountType: true,
} as const;

const workRequestInclude = {
  sender: { select: workRequestPartySelect },
  recipient: { select: workRequestPartySelect },
  jobListing: true,
  jobApplication: true,
  serviceOffering: { select: { id: true, title: true } },
  workEngagement: {
    include: {
      reviews: {
        select: {
          id: true,
          reviewerId: true,
          rating: true,
          body: true,
          createdAt: true,
          media: {
            orderBy: { position: 'asc' as const },
            select: {
              id: true,
              mediaAssetId: true,
              mediaAsset: { select: { mimeType: true } },
            },
          },
        },
      },
    },
  },
  events: { orderBy: { createdAt: 'asc' as const } },
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { mediaAsset: { select: { mimeType: true, byteSize: true } } },
  },
} as const;

const attachmentInclude = {
  mediaAsset: { select: { mimeType: true, byteSize: true } },
} as const;

@Injectable()
export class PrismaMarketplaceRepository implements MarketplaceRepository {
  private readonly logger = new Logger(PrismaMarketplaceRepository.name);
  constructor(private readonly prisma: PrismaService) {}

  createListing(input: CreateListingInput): Promise<JobListingWithPoster> {
    return this.prisma.$transaction(async (tx) => {
      const taxonomy = await resolveCanonicalTaxonomy(tx, {
        categoryId: input.categoryId,
        skillIds: input.skillIds ?? [],
        requireCategory: true,
      });
      const custom = await resolveCustomCategory(tx, {
        resultingCategoryId: taxonomy.category!.id,
        customCategory: input.customCategory,
        existingCustomCategory: null,
      });
      const columns = taxonomyColumnPatch({
        category: taxonomy.category,
        custom,
        existingCustomCategory: null,
      });
      return tx.jobListing.create({
        data: {
          posterId: input.posterId,
          title: input.title,
          companyName: input.companyName ?? null,
          employmentType: input.employmentType,
          location: input.location,
          currency: input.currency ?? 'SAR',
          pricingType: input.pricingType ?? JobPricingType.negotiable,
          fixedAmount: input.fixedAmount ?? null,
          minAmount: input.minAmount ?? null,
          maxAmount: input.maxAmount ?? null,
          salaryLabel: input.salaryLabel ?? null,
          description: input.description ?? '',
          categoryId: columns.categoryId,
          customCategory: columns.customCategory ?? null,
          exploreTag: columns.legacyLabel,
          skills: (taxonomy.skills ?? []).map((skill) => skill.nameEn),
          taxonomySkills: {
            create: (taxonomy.skills ?? []).map((skill) => ({
              skillId: skill.id,
              position: skill.position,
            })),
          },
          status: input.status ?? JobListingStatus.draft,
          postedAt: input.postedAt ?? null,
        },
        include: listingInclude,
      });
    });
  }

  updateListing(
    id: string,
    input: UpdateListingInput,
  ): Promise<JobListingWithPoster> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM job_listings
        WHERE id = ${id}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      const current = await tx.jobListing.findFirst({
        where: { id, deletedAt: null },
        include: { taxonomySkills: { select: { skillId: true } } },
      });
      if (!current) throw new NotFoundException('Job listing not found');
      const taxonomy = await resolveCanonicalTaxonomy(tx, {
        categoryId: input.categoryId,
        skillIds: input.skillIds,
        existingCategoryId: current.categoryId,
        existingSkillIds: current.taxonomySkills.map((row) => row.skillId),
        requireCategory: false,
      });
      const custom = await resolveCustomCategory(tx, {
        resultingCategoryId: taxonomy.category?.id ?? current.categoryId,
        customCategory: input.customCategory,
        existingCustomCategory: current.customCategory,
      });
      const columns = taxonomyColumnPatch({
        category: taxonomy.category,
        custom,
        existingCustomCategory: current.customCategory,
      });
      if (taxonomy.skills) {
        await tx.jobSkill.deleteMany({ where: { listingId: id } });
        if (taxonomy.skills.length > 0) {
          await tx.jobSkill.createMany({
            data: taxonomy.skills.map((skill) => ({
              listingId: id,
              skillId: skill.id,
              position: skill.position,
            })),
          });
        }
      }
      return tx.jobListing.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.companyName !== undefined
          ? { companyName: input.companyName }
          : {}),
        ...(input.employmentType !== undefined
          ? { employmentType: input.employmentType }
          : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.pricingType !== undefined
          ? { pricingType: input.pricingType }
          : {}),
        ...(input.fixedAmount !== undefined
          ? { fixedAmount: input.fixedAmount }
          : {}),
        ...(input.minAmount !== undefined
          ? { minAmount: input.minAmount }
          : {}),
        ...(input.maxAmount !== undefined
          ? { maxAmount: input.maxAmount }
          : {}),
        ...(input.salaryLabel !== undefined
          ? { salaryLabel: input.salaryLabel }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(columns.categoryId
          ? {
              categoryId: columns.categoryId,
              exploreTag: columns.legacyLabel,
            }
          : columns.legacyLabel
            ? { exploreTag: columns.legacyLabel }
            : {}),
        ...(columns.customCategory !== undefined
          ? { customCategory: columns.customCategory }
          : {}),
        ...(taxonomy.skills
          ? { skills: taxonomy.skills.map((skill) => skill.nameEn) }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.postedAt !== undefined ? { postedAt: input.postedAt } : {}),
      },
      include: listingInclude,
    });
    });
  }

  async softDeleteListing(id: string): Promise<void> {
    await this.prisma.jobListing.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  findListingById(id: string): Promise<JobListingWithPoster | null> {
    return this.prisma.jobListing.findFirst({
      where: { id, deletedAt: null },
      include: listingInclude,
    });
  }

  private async listingWhere(
    filter: ListListingsFilter,
  ): Promise<Prisma.JobListingWhereInput> {
    const statuses = filter.status
      ? Array.isArray(filter.status)
        ? filter.status
        : [filter.status]
      : undefined;
    const q = filter.q?.trim();
    const legacySkillMatchIds = q ? await this.skillMatchIds(q) : [];
    const taxonomy: Prisma.JobListingWhereInput[] = [];
    if (filter.filterCategoryIds?.length) {
      taxonomy.push({ categoryId: { in: filter.filterCategoryIds } });
    }
    return {
      deletedAt: null,
      ...(filter.posterId ? { posterId: filter.posterId } : {}),
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(filter.exploreTag ? { exploreTag: filter.exploreTag } : {}),
      ...(filter.employmentType
        ? { employmentType: filter.employmentType }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { description: { contains: q, mode: 'insensitive' as const } },
              { companyName: { contains: q, mode: 'insensitive' as const } },
              { location: { contains: q, mode: 'insensitive' as const } },
              { exploreTag: { contains: q, mode: 'insensitive' as const } },
              ...(legacySkillMatchIds.length > 0
                ? [{ id: { in: legacySkillMatchIds } }]
                : []),
              ...(filter.searchSkillIds?.length
                ? [
                    {
                      taxonomySkills: {
                        some: { skillId: { in: filter.searchSkillIds } },
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
      ...(taxonomy.length > 0 ? { AND: taxonomy } : {}),
    };
  }

  private async skillMatchIds(q: string): Promise<string[]> {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM job_listings
      WHERE deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM unnest(skills) AS sk
          WHERE sk ILIKE ${like} ESCAPE ${'\\'}
        )
    `;
    return rows.map((row) => row.id);
  }

  async listListings(
    filter: ListListingsFilter,
  ): Promise<JobListingWithPoster[]> {
    return this.prisma.jobListing.findMany({
      where: await this.listingWhere(filter),
      include: listingInclude,
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: filter.take ?? 50,
      skip: filter.skip ?? 0,
    });
  }

  async countListings(filter: ListListingsFilter): Promise<number> {
    return this.prisma.jobListing.count({
      where: await this.listingWhere(filter),
    });
  }

  async createApplicationWithWorkRequest(input: {
    listingId: string;
    applicantId: string;
    posterId: string;
    coverLetter: string;
    title: string;
    terms: WorkRequestTerms;
  }): Promise<{
    application: JobApplicationWithRelations;
    workRequest: WorkRequestWithRelations;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.jobApplication.create({
        data: {
          listingId: input.listingId,
          applicantId: input.applicantId,
          coverLetter: input.coverLetter,
          status: JobApplicationStatus.submitted,
        },
        include: {
          applicant: { select: { ...partySelect, accountType: true } },
          listing: { include: applicationListingInclude },
        },
      });

      const workRequest = await tx.workRequest.create({
        data: {
          source: 'job_posting',
          senderUserId: input.applicantId,
          recipientUserId: input.posterId,
          clientUserId: input.posterId,
          providerUserId: input.applicantId,
          jobListingId: input.listingId,
          jobApplicationId: application.id,
          title: input.title,
          status: WorkRequestStatus.pending,
          termsJson: toJson(input.terms),
          // The sender has obviously seen their own request; the recipient has not.
          senderLastViewedAt: new Date(),
          events: {
            create: {
              type: WorkRequestEventType.created,
              actorId: input.applicantId,
              toStatus: WorkRequestStatus.pending,
              note: 'Application submitted',
            },
          },
        },
        include: workRequestInclude,
      });

      return { application, workRequest };
    });
  }

  findApplicationById(id: string): Promise<JobApplicationWithRelations | null> {
    return this.prisma.jobApplication.findFirst({
      where: { id, deletedAt: null },
      include: {
        applicant: { select: { ...partySelect, accountType: true } },
        listing: { include: applicationListingInclude },
      },
    });
  }

  findApplicationByListingAndApplicant(listingId: string, applicantId: string) {
    return this.prisma.jobApplication.findFirst({
      where: { listingId, applicantId, deletedAt: null },
    });
  }

  listApplicationsForListing(
    listingId: string,
  ): Promise<JobApplicationWithRelations[]> {
    return this.prisma.jobApplication.findMany({
      where: { listingId, deletedAt: null },
      include: {
        applicant: { select: { ...partySelect, accountType: true } },
        listing: { include: applicationListingInclude },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listApplicationsForApplicant(
    applicantId: string,
  ): Promise<JobApplicationWithRelations[]> {
    return this.prisma.jobApplication.findMany({
      where: { applicantId, deletedAt: null },
      include: {
        applicant: { select: { ...partySelect, accountType: true } },
        listing: { include: applicationListingInclude },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateApplicationStatus(
    id: string,
    status: JobApplicationStatus,
  ): Promise<JobApplicationWithRelations> {
    return this.prisma.jobApplication.update({
      where: { id },
      data: { status },
      include: {
        applicant: { select: { ...partySelect, accountType: true } },
        listing: { include: applicationListingInclude },
      },
    });
  }

  private engagementInclude() {
    return {
      client: { select: partySelect },
      provider: { select: partySelect },
      detail: true,
      events: { orderBy: { createdAt: 'asc' as const } },
      listing: true,
      reviews: {
        select: {
          id: true,
          reviewerId: true,
          rating: true,
          body: true,
          createdAt: true,
          media: {
            orderBy: { position: 'asc' as const },
            select: {
              id: true,
              mediaAssetId: true,
              mediaAsset: { select: { mimeType: true } },
            },
          },
        },
      },
    };
  }

  findEngagementById(id: string): Promise<WorkEngagementWithRelations | null> {
    return this.prisma.workEngagement.findFirst({
      where: { id, deletedAt: null },
      include: this.engagementInclude(),
    });
  }

  listEngagementsForUser(
    userId: string,
  ): Promise<WorkEngagementWithRelations[]> {
    return this.prisma.workEngagement.findMany({
      where: {
        deletedAt: null,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      include: this.engagementInclude(),
      orderBy: { updatedAt: 'desc' },
    });
  }

  listCalendarSchedules(
    input: CalendarScheduleQuery,
  ): Promise<CalendarScheduleRow[]> {
    return this.prisma.engagementSchedule.findMany({
      where: {
        startDate: { lte: input.to },
        endDate: { gte: input.from },
        engagement: {
          deletedAt: null,
          status: { in: [...CALENDAR_SCHEDULED_STATUSES] },
          OR: [{ clientId: input.userId }, { providerId: input.userId }],
        },
      },
      select: {
        kind: true,
        startDate: true,
        endDate: true,
        source: true,
        engagement: { select: calendarEngagementSelect },
      },
      orderBy: [
        { startDate: 'asc' },
        { endDate: 'asc' },
        { engagementId: 'asc' },
      ],
      take: CALENDAR_SCHEDULED_LIMIT + 1,
    });
  }

  listUnscheduledCalendarEngagements(
    input: CalendarUnscheduledQuery,
  ): Promise<CalendarUnscheduledRow[]> {
    return this.prisma.workEngagement.findMany({
      where: {
        deletedAt: null,
        status: { in: [...CALENDAR_UNSCHEDULED_STATUSES] },
        OR: [{ clientId: input.userId }, { providerId: input.userId }],
        schedule: { is: null },
      },
      select: {
        id: true,
        title: true,
        status: true,
        clientId: true,
        providerId: true,
        createdAt: true,
        client: { select: calendarPartySelect },
        provider: { select: calendarPartySelect },
        workRequest: { select: { id: true, deletedAt: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CALENDAR_UNSCHEDULED_LIMIT + 1,
    });
  }

  findEngagementScheduleState(
    id: string,
  ): Promise<EngagementScheduleStateRow | null> {
    return this.prisma.workEngagement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        clientId: true,
        providerId: true,
        schedule: {
          select: {
            kind: true,
            startDate: true,
            endDate: true,
            source: true,
          },
        },
      },
    });
  }

  async transitionEngagement(input: {
    id: string;
    from: WorkEngagementStatus;
    to: WorkEngagementStatus;
    actorId: string;
    note?: string;
  }): Promise<WorkEngagementWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      let movedCount = 0;
      if (input.to === WorkEngagementStatus.completed) {
        movedCount = await tx.$executeRaw`
          UPDATE work_engagements
          SET status = CAST(${input.to} AS "WorkEngagementStatus"),
              completed_at = COALESCE(completed_at, ${now}),
              review_window_closes_at = COALESCE(
                review_window_closes_at,
                COALESCE(completed_at, ${now}) + interval '14 days'
              ),
              updated_at = ${now}
          WHERE id = ${input.id}::uuid
            AND status = CAST(${input.from} AS "WorkEngagementStatus")
            AND deleted_at IS NULL
        `;
      } else {
        const moved = await tx.workEngagement.updateMany({
          where: {
            id: input.id,
            status: input.from,
            deletedAt: null,
          },
          data: { status: input.to },
        });
        movedCount = moved.count;
      }
      if (movedCount !== 1) {
        throw new ConflictException(
          'Engagement was updated by another request — refresh and try again',
        );
      }
      const resolvingDuration =
        input.from === WorkEngagementStatus.pending_payment &&
        input.to === WorkEngagementStatus.in_progress;
      const startedAt = resolvingDuration ? new Date() : null;
      await tx.engagementEvent.create({
        data: {
          engagementId: input.id,
          fromStatus: input.from,
          toStatus: input.to,
          actorId: input.actorId,
          note: input.note ?? '',
          ...(startedAt ? { createdAt: startedAt } : {}),
        },
      });
      if (startedAt) {
        await this.insertDurationSchedule(tx, input.id, startedAt);
      }
      const updated = await tx.workEngagement.findFirst({
        where: { id: input.id, deletedAt: null },
        include: this.engagementInclude(),
      });
      if (!updated) throw new NotFoundException('Work engagement not found');
      return updated;
    });
  }

  /**
   * First work start only. A duration with no trustworthy shape is skipped
   * so a succeeded payment cannot get stuck in pending_payment. An existing
   * agreed date is left alone. Revisions never call this.
   */
  private async insertDurationSchedule(
    tx: Prisma.TransactionClient,
    engagementId: string,
    startedAt: Date,
  ): Promise<void> {
    const existing = await tx.engagementSchedule.findUnique({
      where: { engagementId },
      select: { engagementId: true },
    });
    if (existing) return;

    const request = await tx.workRequest.findFirst({
      where: { workEngagementId: engagementId },
      select: { agreedTermsJson: true },
    });
    const deadline = deadlineFromAgreedTerms(request?.agreedTermsJson);
    if (!deadline || deadline.type !== 'duration') return;

    const draft = scheduleFromDuration(deadline, businessTodayIso(startedAt));
    if (!draft) {
      this.logger.warn(
        `Duration schedule skipped for engagement ${engagementId}`,
      );
      return;
    }
    await tx.engagementSchedule.create({
      data: { engagementId, ...scheduleCreateData(draft) },
    });
  }

  findServiceOfferingById(id: string): Promise<ServiceOfferingSnapshot | null> {
    return this.prisma.serviceOffering.findFirst({
      where: { id, deletedAt: null },
      include: {
        packages: true,
        addons: { orderBy: { position: 'asc' } },
      },
    });
  }

  createWorkRequest(
    input: CreateWorkRequestInput,
  ): Promise<WorkRequestWithRelations> {
    return this.prisma.workRequest.create({
      data: {
        source: input.source,
        senderUserId: input.senderUserId,
        recipientUserId: input.recipientUserId,
        clientUserId: input.clientUserId,
        providerUserId: input.providerUserId,
        jobListingId: input.jobListingId ?? null,
        jobApplicationId: input.jobApplicationId ?? null,
        serviceOfferingId: input.serviceOfferingId ?? null,
        title: input.title,
        status: WorkRequestStatus.pending,
        termsJson: toJson(input.terms),
        senderLastViewedAt: new Date(),
        events: {
          create: {
            type: WorkRequestEventType.created,
            actorId: input.senderUserId,
            toStatus: WorkRequestStatus.pending,
            note: 'Request sent',
          },
        },
      },
      include: workRequestInclude,
    });
  }

  findWorkRequestById(id: string): Promise<WorkRequestWithRelations | null> {
    return this.prisma.workRequest.findFirst({
      where: { id, deletedAt: null },
      include: workRequestInclude,
    });
  }

  findWorkRequestByApplicationId(
    applicationId: string,
  ): Promise<WorkRequestWithRelations | null> {
    return this.prisma.workRequest.findFirst({
      where: { jobApplicationId: applicationId, deletedAt: null },
      include: workRequestInclude,
    });
  }

  listWorkRequests(
    filter: ListWorkRequestsFilter,
  ): Promise<WorkRequestWithRelations[]> {
    return this.prisma.workRequest.findMany({
      where: {
        deletedAt: null,
        ...(filter.direction === 'sent'
          ? { senderUserId: filter.userId }
          : { recipientUserId: filter.userId }),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: workRequestInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async countUnreadWorkRequests(
    userId: string,
  ): Promise<WorkRequestUnreadSummary> {
    // Column-to-column comparison is not expressible in the Prisma query API.
    const rows = await this.prisma.$queryRaw<
      Array<{ sent_unread: bigint; received_unread: bigint }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE "sender_user_id" = ${userId}::uuid
            AND "updated_at" > COALESCE("sender_last_viewed_at", to_timestamp(0))
        ) AS sent_unread,
        COUNT(*) FILTER (
          WHERE "recipient_user_id" = ${userId}::uuid
            AND "updated_at" > COALESCE("recipient_last_viewed_at", to_timestamp(0))
        ) AS received_unread
      FROM "work_requests"
      WHERE "deleted_at" IS NULL
        AND ("sender_user_id" = ${userId}::uuid OR "recipient_user_id" = ${userId}::uuid)
    `);
    const row = rows[0];
    return {
      sentUnread: Number(row?.sent_unread ?? 0),
      receivedUnread: Number(row?.received_unread ?? 0),
    };
  }

  async markWorkRequestViewed(
    id: string,
    side: 'sender' | 'recipient',
  ): Promise<WorkRequestWithRelations> {
    // Raw update so Prisma's @updatedAt does not fire — a view is not activity,
    // and bumping updated_at would mark the request unread for the other party.
    if (side === 'sender') {
      await this.prisma.$executeRaw`
        UPDATE "work_requests" SET "sender_last_viewed_at" = NOW() WHERE "id" = ${id}::uuid
      `;
    } else {
      await this.prisma.$executeRaw`
        UPDATE "work_requests" SET "recipient_last_viewed_at" = NOW() WHERE "id" = ${id}::uuid
      `;
    }
    const updated = await this.findWorkRequestById(id);
    if (!updated) throw new NotFoundException('Work request not found');
    return updated;
  }

  async updateWorkRequest(input: {
    id: string;
    from: WorkRequestStatus;
    to: WorkRequestStatus;
    actorSide: 'sender' | 'recipient';
    event: WorkRequestEventInput;
    data?: {
      proposedTerms?: WorkRequestTerms | null;
      agreedTerms?: WorkRequestTerms;
      proposedByUserId?: string | null;
      proposalComment?: string;
      rejectionComment?: string;
    };
  }): Promise<WorkRequestWithRelations> {
    return this.prisma.workRequest.update({
      where: { id: input.id },
      data: {
        status: input.to,
        // The actor has seen what they just did; only the other side is unread.
        ...(input.actorSide === 'sender'
          ? { senderLastViewedAt: new Date() }
          : { recipientLastViewedAt: new Date() }),
        ...(input.data?.proposedTerms !== undefined
          ? {
              proposedTermsJson:
                input.data.proposedTerms === null
                  ? Prisma.DbNull
                  : toJson(input.data.proposedTerms),
            }
          : {}),
        ...(input.data?.agreedTerms
          ? { agreedTermsJson: toJson(input.data.agreedTerms) }
          : {}),
        ...(input.data?.proposedByUserId !== undefined
          ? { proposedByUserId: input.data.proposedByUserId }
          : {}),
        ...(input.data?.proposalComment !== undefined
          ? { proposalComment: input.data.proposalComment }
          : {}),
        ...(input.data?.rejectionComment !== undefined
          ? { rejectionComment: input.data.rejectionComment }
          : {}),
        events: {
          create: this.workRequestEventData(input.event, input.from, input.to),
        },
      },
      include: workRequestInclude,
    });
  }

  private workRequestEventData(
    event: WorkRequestEventInput,
    from: WorkRequestStatus,
    to: WorkRequestStatus,
  ) {
    return {
      type: event.type,
      actorId: event.actorId ?? null,
      fromStatus: event.fromStatus === undefined ? from : event.fromStatus,
      toStatus: event.toStatus === undefined ? to : event.toStatus,
      note: event.note ?? '',
      ...(event.payload !== undefined ? { payload: event.payload } : {}),
    };
  }

  async acceptWorkRequestTransactional(input: {
    workRequestId: string;
    actorId: string;
    agreedTerms: WorkRequestTerms;
    eventType: WorkRequestEventType;
    engagementSource: WorkEngagementSource;
    expectedStatus: WorkRequestStatus;
    note?: string;
  }): Promise<{
    workRequest: WorkRequestWithRelations;
    engagement: WorkEngagementWithRelations;
  }> {
    // Writes only. Response graphs are loaded after commit so pooler latency
    // on nested reads cannot expire the interactive transaction.
    const ids = await this.prisma.$transaction(
      async (tx) => {
      // Row lock prevents double-accept from creating two engagements.
      await tx.$executeRaw`
        SELECT id FROM work_requests
        WHERE id = ${input.workRequestId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;

      const request = await tx.workRequest.findFirst({
        where: { id: input.workRequestId, deletedAt: null },
      });
      if (!request) throw new NotFoundException('Work request not found');
      if (request.workEngagementId) {
        throw new ConflictException('This request already has an engagement');
      }
      if (request.status !== input.expectedStatus) {
        throw new ConflictException(
          'This request changed. Refresh and try again.',
        );
      }
      if (
        request.status !== WorkRequestStatus.pending &&
        request.status !== WorkRequestStatus.changes_requested &&
        request.status !== WorkRequestStatus.changes_declined
      ) {
        throw new ConflictException(
          'This request is no longer open for acceptance',
        );
      }

      const terms = input.agreedTerms;
      const agreedSchedule = scheduleFromAgreedDeadline(terms.deadline);
      const engagement = await tx.workEngagement.create({
        data: {
          listingId: request.jobListingId,
          applicationId: request.jobApplicationId,
          serviceOfferingId: request.serviceOfferingId,
          clientId: request.clientUserId,
          providerId: request.providerUserId,
          title: terms.title || request.title,
          // Accepted terms still owe payment — Phase 5 moves this to in_progress.
          status: WorkEngagementStatus.pending_payment,
          source: input.engagementSource,
          ...(agreedSchedule
            ? { schedule: { create: scheduleCreateData(agreedSchedule) } }
            : {}),
          detail: {
            create: {
              serviceName: terms.title || request.title,
              packageName: terms.packageName ?? '',
              packagePrice: terms.money?.amount ?? 0,
              currency: terms.money?.currency ?? DEFAULT_CURRENCY,
              addons: (terms.addons ?? []) as unknown as Prisma.InputJsonValue,
              deadlineLabel: formatDeadline(terms.deadline) || null,
              locationCity: terms.location ?? null,
              notes: terms.notes,
              coverLetter: terms.notes,
            },
          },
          events: {
            create: {
              fromStatus: null,
              toStatus: WorkEngagementStatus.pending_payment,
              actorId: input.actorId,
              note: input.note ?? 'Created from accepted work request',
            },
          },
        },
      });

      if (request.jobApplicationId) {
        await tx.jobApplication.updateMany({
          where: {
            id: request.jobApplicationId,
            status: {
              in: [
                JobApplicationStatus.submitted,
                JobApplicationStatus.under_review,
              ],
            },
          },
          data: { status: JobApplicationStatus.accepted },
        });
      }

      const actorIsSender = request.senderUserId === input.actorId;
      const claimed = await tx.workRequest.updateMany({
        where: {
          id: request.id,
          status: request.status,
          workEngagementId: null,
        },
        data: {
          status: WorkRequestStatus.pending_payment,
          agreedTermsJson: toJson(terms),
          workEngagementId: engagement.id,
          ...(actorIsSender
            ? { senderLastViewedAt: new Date() }
            : { recipientLastViewedAt: new Date() }),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'This request was already accepted or closed',
        );
      }

      await tx.workRequestEvent.create({
        data: {
          workRequestId: request.id,
          type: input.eventType,
          actorId: input.actorId,
          fromStatus: request.status,
          toStatus: WorkRequestStatus.pending_payment,
          note: input.note ?? '',
        },
      });

      return { workRequestId: request.id, engagementId: engagement.id };
      },
      // Defense in depth for the remaining writes. Hydration is outside.
      { maxWait: 5_000, timeout: 10_000 },
    );

    return this.loadAcceptedGraphs(ids.workRequestId, ids.engagementId);
  }

  /** Reads after commit. One retry covers a pooler hiccup without rolling back. */
  private async loadAcceptedGraphs(
    workRequestId: string,
    engagementId: string,
  ): Promise<{
    workRequest: WorkRequestWithRelations;
    engagement: WorkEngagementWithRelations;
  }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [workRequest, engagement] = await Promise.all([
        this.findWorkRequestById(workRequestId),
        this.findEngagementById(engagementId),
      ]);
      if (workRequest && engagement) return { workRequest, engagement };
    }
    throw new ConflictException(
      'This request was accepted. Refresh and continue.',
    );
  }

  async withdrawPendingPaymentTransactional(input: {
    workRequestId: string;
    engagementId: string;
    actorId: string;
    note?: string;
    jobApplicationId?: string | null;
    jobApplicationStatus?: JobApplicationStatus | null;
  }): Promise<WorkRequestWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM work_requests
        WHERE id = ${input.workRequestId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;

      const engMoved = await tx.workEngagement.updateMany({
        where: {
          id: input.engagementId,
          status: WorkEngagementStatus.pending_payment,
          deletedAt: null,
        },
        data: { status: WorkEngagementStatus.cancelled },
      });
      if (engMoved.count !== 1) {
        throw new ConflictException(
          'Engagement was updated by another request — refresh and try again',
        );
      }
      await tx.engagementEvent.create({
        data: {
          engagementId: input.engagementId,
          fromStatus: WorkEngagementStatus.pending_payment,
          toStatus: WorkEngagementStatus.cancelled,
          actorId: input.actorId,
          note: input.note ?? 'Work request cancelled before payment',
        },
      });

      const wrMoved = await tx.workRequest.updateMany({
        where: {
          id: input.workRequestId,
          status: WorkRequestStatus.pending_payment,
          deletedAt: null,
        },
        data: {
          status: WorkRequestStatus.withdrawn,
          senderLastViewedAt: new Date(),
        },
      });
      if (wrMoved.count !== 1) {
        throw new ConflictException(
          'Work request was updated by another request — refresh and try again',
        );
      }
      await tx.workRequestEvent.create({
        data: {
          workRequestId: input.workRequestId,
          type: WorkRequestEventType.withdrawn,
          actorId: input.actorId,
          fromStatus: WorkRequestStatus.pending_payment,
          toStatus: WorkRequestStatus.withdrawn,
          note: input.note ?? '',
        },
      });

      if (
        input.jobApplicationId &&
        input.jobApplicationStatus &&
        (input.jobApplicationStatus === JobApplicationStatus.submitted ||
          input.jobApplicationStatus === JobApplicationStatus.under_review ||
          input.jobApplicationStatus === JobApplicationStatus.accepted)
      ) {
        await tx.jobApplication.updateMany({
          where: {
            id: input.jobApplicationId,
            status: {
              in: [
                JobApplicationStatus.submitted,
                JobApplicationStatus.under_review,
                JobApplicationStatus.accepted,
              ],
            },
          },
          data: { status: JobApplicationStatus.withdrawn },
        });
      }

      const updated = await tx.workRequest.findFirst({
        where: { id: input.workRequestId, deletedAt: null },
        include: workRequestInclude,
      });
      if (!updated) throw new NotFoundException('Work request not found');
      return updated;
    });
  }

  async rejectOpenWorkRequestsForListing(input: {
    listingId: string;
    actorId: string;
    note: string;
  }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.workRequest.findMany({
        where: {
          jobListingId: input.listingId,
          deletedAt: null,
          status: {
            in: [
              WorkRequestStatus.pending,
              WorkRequestStatus.changes_requested,
              WorkRequestStatus.changes_declined,
            ],
          },
        },
        select: { id: true, status: true, jobApplicationId: true },
      });

      for (const request of open) {
        await tx.workRequest.update({
          where: { id: request.id },
          data: {
            status: WorkRequestStatus.rejected,
            rejectionComment: input.note,
            events: {
              create: {
                type: WorkRequestEventType.listing_closed,
                actorId: input.actorId,
                fromStatus: request.status,
                toStatus: WorkRequestStatus.rejected,
                note: input.note,
              },
            },
          },
        });

        if (request.jobApplicationId) {
          await tx.jobApplication.updateMany({
            where: {
              id: request.jobApplicationId,
              status: {
                in: [
                  JobApplicationStatus.submitted,
                  JobApplicationStatus.under_review,
                ],
              },
            },
            data: { status: JobApplicationStatus.rejected },
          });
        }
      }

      return open.length;
    });
  }

  findEngagementReview(
    engagementId: string,
    reviewerId: string,
  ): Promise<EngagementReview | null> {
    return this.prisma.engagementReview.findUnique({
      where: {
        engagementId_reviewerId: { engagementId, reviewerId },
      },
    });
  }

  async createEngagementReview(input: {
    id: string;
    engagementId: string;
    reviewerId: string;
    revieweeId: string;
    rating: number;
    body: string;
    mediaAssetIds?: string[];
  }): Promise<EngagementReview> {
    return this.prisma.$transaction(async (tx) => {
      // A duplicate (engagement, reviewer) fails here with P2002 before any
      // aggregate is touched, so a rating is never counted twice.
      return tx.engagementReview.create({
        data: {
          id: input.id,
          engagementId: input.engagementId,
          reviewerId: input.reviewerId,
          revieweeId: input.revieweeId,
          rating: input.rating,
          body: input.body,
          ...(input.mediaAssetIds?.length
            ? {
                media: {
                  create: input.mediaAssetIds.map((mediaAssetId, position) => ({
                    mediaAssetId,
                    position,
                  })),
                },
              }
            : {}),
        },
      });
    });
  }

  async listReviewsForReviewee(
    userId: string,
    page: { take: number; skip: number },
  ): Promise<{ items: UserReviewWithRelations[]; total: number }> {
    // Reviewers are always engagement parties, so "reviewer is not the user"
    // on an engagement the user belongs to means the user was the reviewee.
    const where = {
      reviewerId: { not: userId },
      engagement: {
        deletedAt: null,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.engagementReview.findMany({
        where,
        include: {
          reviewer: { select: partySelect },
          engagement: {
            select: {
              id: true,
              title: true,
              source: true,
              clientId: true,
              providerId: true,
              listing: {
                select: { title: true, status: true, deletedAt: true },
              },
              serviceOffering: {
                select: { title: true, status: true, deletedAt: true },
              },
            },
          },
          media: {
            orderBy: { position: 'asc' },
            include: { mediaAsset: { select: { mimeType: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: page.take,
        skip: page.skip,
      }),
      this.prisma.engagementReview.count({ where }),
    ]);
    return { items, total };
  }

  createWorkRequestAttachment(input: {
    id: string;
    workRequestId: string;
    mediaAssetId: string;
    uploadedByUserId: string;
    originalFileName: string;
  }): Promise<WorkRequestAttachmentWithMedia> {
    return this.prisma.workRequestAttachment.create({
      data: {
        id: input.id,
        workRequestId: input.workRequestId,
        mediaAssetId: input.mediaAssetId,
        uploadedByUserId: input.uploadedByUserId,
        originalFileName: input.originalFileName,
      },
      include: attachmentInclude,
    });
  }

  listWorkRequestAttachments(
    workRequestId: string,
  ): Promise<WorkRequestAttachmentWithMedia[]> {
    return this.prisma.workRequestAttachment.findMany({
      where: { workRequestId, deletedAt: null },
      include: attachmentInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  findWorkRequestAttachment(
    workRequestId: string,
    attachmentId: string,
  ): Promise<WorkRequestAttachmentWithMedia | null> {
    return this.prisma.workRequestAttachment.findFirst({
      where: { id: attachmentId, workRequestId, deletedAt: null },
      include: attachmentInclude,
    });
  }

  async softDeleteWorkRequestAttachment(attachmentId: string): Promise<void> {
    await this.prisma.workRequestAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });
  }

  findListingSaveTarget(id: string) {
    return this.prisma.jobListing.findFirst({
      where: { id },
      select: {
        id: true,
        posterId: true,
        status: true,
        deletedAt: true,
        poster: { select: { deletedAt: true } },
      },
    });
  }

  async viewerHasLiveApplication(
    listingId: string,
    applicantId: string,
  ): Promise<boolean> {
    const row = await this.prisma.jobApplication.findFirst({
      where: { listingId, applicantId, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async createJobSave(jobId: string, userId: string): Promise<void> {
    await this.prisma.jobSave.create({ data: { jobId, userId } });
  }

  async deleteJobSave(jobId: string, userId: string): Promise<void> {
    await this.prisma.jobSave.deleteMany({ where: { jobId, userId } });
  }

  findJobSave(jobId: string, userId: string) {
    return this.prisma.jobSave.findUnique({
      where: { jobId_userId: { jobId, userId } },
      select: { jobId: true },
    });
  }

  async listJobSaveIds(userId: string, jobIds: string[]): Promise<string[]> {
    if (jobIds.length === 0) return [];
    const rows = await this.prisma.jobSave.findMany({
      where: { userId, jobId: { in: jobIds } },
      select: { jobId: true },
    });
    return rows.map((row) => row.jobId);
  }

  listSavedJobs(
    viewerId: string,
    cursor: { createdAt: string; id: string } | null,
    take: number,
  ) {
    return this.prisma.jobSave.findMany({
      where: savedJobWhere(viewerId, cursor),
      include: { job: { include: listingInclude } },
      orderBy: [{ createdAt: 'desc' }, { jobId: 'desc' }],
      take,
    });
  }
}
