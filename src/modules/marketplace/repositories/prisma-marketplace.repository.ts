import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JobApplicationStatus,
  JobListingStatus,
  Prisma,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestStatus,
  type EngagementReview,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  DEFAULT_CURRENCY,
  formatDeadline,
  toJson,
  type WorkRequestTerms,
} from '../work-request-terms';
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
  WorkEngagementWithRelations,
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

const partySelect = {
  id: true,
  displayName: true,
  username: true,
  isVerified: true,
  profile: { select: { avatarUrl: true, title: true } },
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
  workEngagement: true,
  events: { orderBy: { createdAt: 'asc' as const } },
} as const;

@Injectable()
export class PrismaMarketplaceRepository implements MarketplaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  createListing(input: CreateListingInput): Promise<JobListingWithPoster> {
    return this.prisma.jobListing.create({
      data: {
        posterId: input.posterId,
        title: input.title,
        companyName: input.companyName ?? null,
        employmentType: input.employmentType,
        location: input.location,
        salaryLabel: input.salaryLabel ?? null,
        description: input.description ?? '',
        skills: input.skills ?? [],
        exploreTag: input.exploreTag ?? null,
        status: input.status ?? JobListingStatus.draft,
        postedAt: input.postedAt ?? null,
      },
      include: { poster: { select: posterSelect } },
    });
  }

  updateListing(
    id: string,
    input: UpdateListingInput,
  ): Promise<JobListingWithPoster> {
    return this.prisma.jobListing.update({
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
        ...(input.salaryLabel !== undefined
          ? { salaryLabel: input.salaryLabel }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.skills !== undefined ? { skills: input.skills } : {}),
        ...(input.exploreTag !== undefined
          ? { exploreTag: input.exploreTag }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.postedAt !== undefined ? { postedAt: input.postedAt } : {}),
      },
      include: { poster: { select: posterSelect } },
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
      include: { poster: { select: posterSelect } },
    });
  }

  private listingWhere(filter: ListListingsFilter) {
    const statuses = filter.status
      ? Array.isArray(filter.status)
        ? filter.status
        : [filter.status]
      : undefined;
    const q = filter.q?.trim();
    return {
      deletedAt: null,
      ...(filter.posterId ? { posterId: filter.posterId } : {}),
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(filter.exploreTag ? { exploreTag: filter.exploreTag } : {}),
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
    };
  }

  listListings(filter: ListListingsFilter): Promise<JobListingWithPoster[]> {
    return this.prisma.jobListing.findMany({
      where: this.listingWhere(filter),
      include: { poster: { select: posterSelect } },
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
      take: filter.take ?? 50,
      skip: filter.skip ?? 0,
    });
  }

  countListings(filter: ListListingsFilter): Promise<number> {
    return this.prisma.jobListing.count({ where: this.listingWhere(filter) });
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
          listing: true,
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
        listing: true,
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
        listing: true,
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
        listing: true,
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
        listing: true,
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

  async transitionEngagement(input: {
    id: string;
    from: WorkEngagementStatus;
    to: WorkEngagementStatus;
    actorId: string;
    note?: string;
  }): Promise<WorkEngagementWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.workEngagement.updateMany({
        where: {
          id: input.id,
          status: input.from,
          deletedAt: null,
        },
        data: { status: input.to },
      });
      if (moved.count !== 1) {
        throw new ConflictException(
          'Engagement was updated by another request — refresh and try again',
        );
      }
      await tx.engagementEvent.create({
        data: {
          engagementId: input.id,
          fromStatus: input.from,
          toStatus: input.to,
          actorId: input.actorId,
          note: input.note ?? '',
        },
      });
      const updated = await tx.workEngagement.findFirst({
        where: { id: input.id, deletedAt: null },
        include: this.engagementInclude(),
      });
      if (!updated) throw new NotFoundException('Work engagement not found');
      return updated;
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
    note?: string;
  }): Promise<{
    workRequest: WorkRequestWithRelations;
    engagement: WorkEngagementWithRelations;
  }> {
    return this.prisma.$transaction(async (tx) => {
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
          detail: {
            create: {
              serviceName: terms.title || request.title,
              packageName: terms.packageName ?? '',
              packagePrice: terms.money?.amount ?? 0,
              currency: terms.money?.currency ?? DEFAULT_CURRENCY,
              addons: (terms.addons ?? []) as unknown as Prisma.InputJsonValue,
              deadlineLabel: formatDeadline(terms.deadline),
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
        include: this.engagementInclude(),
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

      const workRequest = await tx.workRequest.findFirst({
        where: { id: request.id, deletedAt: null },
        include: workRequestInclude,
      });
      if (!workRequest) throw new NotFoundException('Work request not found');

      return { workRequest, engagement };
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

  createEngagementReview(input: {
    id: string;
    engagementId: string;
    reviewerId: string;
    rating: number;
    body: string;
  }): Promise<EngagementReview> {
    return this.prisma.engagementReview.create({
      data: {
        id: input.id,
        engagementId: input.engagementId,
        reviewerId: input.reviewerId,
        rating: input.rating,
        body: input.body,
      },
    });
  }
}
