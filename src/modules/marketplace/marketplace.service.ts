import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobApplicationStatus,
  JobListingStatus,
  NotificationType,
  PackageTier,
  ServiceOfferingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Env } from '../../config/env.schema';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../users/repositories/user.repository';
import {
  CreateApplicationDto,
  CreateDirectWorkRequestDto,
  CreateEngagementReviewDto,
  CreateJobListingDto,
  CreateServiceWorkRequestDto,
  EngagementTransitionDto,
  ListJobListingsQueryDto,
  ListWorkRequestsQueryDto,
  ListingTransitionDto,
  PatchApplicationDto,
  RequestWorkChangesDto,
  UpdateJobListingDto,
  WorkRequestCommentDto,
} from './dto/marketplace.dto';
import {
  AcceptApplicationResponseDto,
  AcceptWorkRequestResponseDto,
  ApplyToListingResponseDto,
  CreateEngagementReviewResponseDto,
  EngagementEventResponseDto,
  EngagementReviewResponseDto,
  JobApplicationResponseDto,
  JobListingResponseDto,
  JobListingsPageDto,
  WorkEngagementResponseDto,
  WorkRequestResponseDto,
  WorkRequestUnreadSummaryDto,
} from './dto/marketplace-response.dto';
import {
  MARKETPLACE_REPOSITORY,
  type MarketplaceRepository,
  type ServiceOfferingSnapshot,
  type WorkRequestWithRelations,
} from './repositories/marketplace.repository';
import {
  OPEN_APPLICATION_STATUSES,
  OPEN_WORK_REQUEST_STATUSES,
  assertApplicationTransition,
  assertEngagementPartyTransition,
  assertListingTransition,
  assertWorkRequestTransition,
} from './state-machines';
import {
  deadlineFromLabel,
  flexibleDeadline,
  mergeTerms,
  moneyFromLabel,
  moneyOf,
  normalizeDeadline,
  parseTerms,
  toTermsChangePayload,
  validateDeadline,
  type WorkRequestDeadline,
  type WorkRequestMoney,
  type WorkRequestTerms,
  type WorkRequestTermsPatch,
} from './work-request-terms';

const ENGAGEMENT_SOURCE_BY_REQUEST_SOURCE: Record<
  WorkRequestSource,
  WorkEngagementSource
> = {
  [WorkRequestSource.job_posting]: WorkEngagementSource.listing_application,
  [WorkRequestSource.service_request]: WorkEngagementSource.service_request,
  [WorkRequestSource.direct_request]: WorkEngagementSource.direct,
};

@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(MARKETPLACE_REPOSITORY)
    private readonly marketplace: MarketplaceRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async createListing(
    userId: string,
    dto: CreateJobListingDto,
  ): Promise<JobListingResponseDto> {
    // Any registered account can post work — talent hires talent too.
    await this.requireUser(userId);
    const publish = dto.publish === true;
    const created = await this.marketplace.createListing({
      posterId: userId,
      title: dto.title.trim(),
      companyName: dto.companyName?.trim() || null,
      employmentType: dto.employmentType,
      location: dto.location.trim(),
      salaryLabel: dto.salaryLabel?.trim() || null,
      description: (dto.description ?? '').trim(),
      skills: dto.skills ?? [],
      exploreTag: dto.exploreTag?.trim() || null,
      status: publish ? JobListingStatus.open : JobListingStatus.draft,
      postedAt: publish ? new Date() : null,
    });
    return JobListingResponseDto.fromEntity(created);
  }

  async updateListing(
    userId: string,
    listingId: string,
    dto: UpdateJobListingDto,
  ): Promise<JobListingResponseDto> {
    const listing = await this.requireOwnedListing(userId, listingId);
    if (
      listing.status === JobListingStatus.completed ||
      listing.status === JobListingStatus.expired
    ) {
      throw new ForbiddenException('Cannot edit a terminal listing');
    }
    const updated = await this.marketplace.updateListing(listingId, {
      title: dto.title?.trim(),
      companyName:
        dto.companyName === undefined
          ? undefined
          : dto.companyName?.trim() || null,
      employmentType: dto.employmentType,
      location: dto.location?.trim(),
      salaryLabel:
        dto.salaryLabel === undefined
          ? undefined
          : dto.salaryLabel?.trim() || null,
      description: dto.description?.trim(),
      skills: dto.skills,
      exploreTag:
        dto.exploreTag === undefined
          ? undefined
          : dto.exploreTag?.trim() || null,
    });
    return JobListingResponseDto.fromEntity(updated);
  }

  async transitionListing(
    userId: string,
    listingId: string,
    dto: ListingTransitionDto,
  ): Promise<JobListingResponseDto> {
    const listing = await this.requireOwnedListing(userId, listingId);
    assertListingTransition(listing.status, dto.status);
    const updated = await this.marketplace.updateListing(listingId, {
      status: dto.status,
      postedAt:
        dto.status === JobListingStatus.open && !listing.postedAt
          ? new Date()
          : undefined,
    });
    // Leaving the open marketplace must close open negotiations. Accepted
    // engagements keep running; reopen does not resurrect rejected requests.
    if (
      dto.status === JobListingStatus.closed ||
      dto.status === JobListingStatus.archived
    ) {
      await this.marketplace.rejectOpenWorkRequestsForListing({
        listingId,
        actorId: userId,
        note:
          dto.status === JobListingStatus.archived
            ? 'Listing was archived'
            : 'Listing was closed',
      });
    }
    return JobListingResponseDto.fromEntity(updated);
  }

  async softDeleteListing(userId: string, listingId: string): Promise<void> {
    await this.requireOwnedListing(userId, listingId);
    await this.marketplace.rejectOpenWorkRequestsForListing({
      listingId,
      actorId: userId,
      note: 'Listing was deleted',
    });
    await this.marketplace.softDeleteListing(listingId);
  }

  async getListing(
    _userId: string,
    listingId: string,
  ): Promise<JobListingResponseDto> {
    const listing = await this.marketplace.findListingById(listingId);
    if (!listing) throw new NotFoundException('Job listing not found');
    return JobListingResponseDto.fromEntity(listing);
  }

  async listListings(
    query: ListJobListingsQueryDto,
  ): Promise<JobListingsPageDto> {
    const take = query.take ?? 50;
    const skip = query.skip ?? 0;
    const status = query.status ?? JobListingStatus.open;
    const filter = {
      status,
      q: query.q,
      exploreTag: query.exploreTag,
      take,
      skip,
    };
    const [items, total] = await Promise.all([
      this.marketplace.listListings(filter),
      this.marketplace.countListings(filter),
    ]);
    return {
      items: items.map((item) => JobListingResponseDto.fromEntity(item)),
      total,
      take,
      skip,
    };
  }

  async listMyListings(userId: string): Promise<JobListingResponseDto[]> {
    const items = await this.marketplace.listListings({
      posterId: userId,
      take: 100,
    });
    return items.map((item) => JobListingResponseDto.fromEntity(item));
  }

  async apply(
    userId: string,
    listingId: string,
    dto: CreateApplicationDto,
  ): Promise<ApplyToListingResponseDto> {
    await this.requireUser(userId);
    const listing = await this.marketplace.findListingById(listingId);
    if (!listing) throw new NotFoundException('Job listing not found');
    if (listing.posterId === userId) {
      throw new ForbiddenException('Cannot apply to your own listing');
    }
    if (listing.status !== JobListingStatus.open) {
      throw new ForbiddenException('Listing is not open for applications');
    }
    const existing =
      await this.marketplace.findApplicationByListingAndApplicant(
        listingId,
        userId,
      );
    if (existing) {
      throw new ConflictException('You have already applied to this listing');
    }

    const coverLetter = dto.coverLetter?.trim() || '';
    const created = await this.marketplace.createApplicationWithWorkRequest({
      listingId,
      applicantId: userId,
      posterId: listing.posterId,
      coverLetter,
      title: listing.title,
      terms: this.listingTerms(listing, coverLetter),
    });

    return {
      application: JobApplicationResponseDto.fromEntity(created.application),
      workRequest: WorkRequestResponseDto.fromEntity(
        created.workRequest,
        userId,
      ),
    };
  }

  async listApplicationsForListing(
    userId: string,
    listingId: string,
  ): Promise<JobApplicationResponseDto[]> {
    await this.requireOwnedListing(userId, listingId);
    const apps = await this.marketplace.listApplicationsForListing(listingId);
    return apps.map((app) => JobApplicationResponseDto.fromEntity(app));
  }

  async listMyApplications(
    userId: string,
  ): Promise<JobApplicationResponseDto[]> {
    const apps = await this.marketplace.listApplicationsForApplicant(userId);
    return apps.map((app) => JobApplicationResponseDto.fromEntity(app));
  }

  async patchApplication(
    userId: string,
    applicationId: string,
    dto: PatchApplicationDto,
  ): Promise<JobApplicationResponseDto | AcceptApplicationResponseDto> {
    const application =
      await this.marketplace.findApplicationById(applicationId);
    if (!application) throw new NotFoundException('Application not found');

    assertApplicationTransition(application.status, dto.status);

    if (dto.status === JobApplicationStatus.withdrawn) {
      if (application.applicantId !== userId) {
        throw new ForbiddenException('Only the applicant can withdraw');
      }
      if (!OPEN_APPLICATION_STATUSES.includes(application.status)) {
        throw new ForbiddenException('Application can no longer be withdrawn');
      }
      const workRequest =
        await this.marketplace.findWorkRequestByApplicationId(applicationId);
      if (workRequest && this.isOpen(workRequest)) {
        await this.marketplace.updateWorkRequest({
          id: workRequest.id,
          from: workRequest.status,
          to: WorkRequestStatus.withdrawn,
          actorSide: 'sender',
          event: {
            type: WorkRequestEventType.withdrawn,
            actorId: userId,
            note: 'Application withdrawn',
          },
        });
      }
      const updated = await this.marketplace.updateApplicationStatus(
        applicationId,
        JobApplicationStatus.withdrawn,
      );
      return JobApplicationResponseDto.fromEntity(updated);
    }

    if (application.listing.posterId !== userId) {
      throw new ForbiddenException(
        'Only the listing owner can review applications',
      );
    }
    if (application.listing.status === JobListingStatus.archived) {
      throw new ForbiddenException(
        'Cannot review applications on an archived listing',
      );
    }
    if (application.listing.status === JobListingStatus.closed) {
      throw new ForbiddenException(
        'Cannot review applications on a closed listing',
      );
    }

    if (dto.status === JobApplicationStatus.accepted) {
      const workRequest = await this.resolveWorkRequestForApplication(
        applicationId,
        userId,
      );
      const accepted = await this.acceptRequest(
        workRequest,
        userId,
        parseTerms(workRequest.termsJson),
        WorkRequestEventType.accepted,
        'Request accepted — pending payment',
      );
      const updatedApplication =
        await this.marketplace.findApplicationById(applicationId);
      return {
        application: JobApplicationResponseDto.fromEntity(
          updatedApplication ?? application,
        ),
        engagement: WorkEngagementResponseDto.fromEntity(accepted.engagement),
        workRequest: WorkRequestResponseDto.fromEntity(
          accepted.workRequest,
          userId,
        ),
      };
    }

    if (dto.status === JobApplicationStatus.rejected) {
      const workRequest =
        await this.marketplace.findWorkRequestByApplicationId(applicationId);
      if (workRequest && this.isOpen(workRequest)) {
        await this.marketplace.updateWorkRequest({
          id: workRequest.id,
          from: workRequest.status,
          to: WorkRequestStatus.rejected,
          actorSide: 'recipient',
          event: {
            type: WorkRequestEventType.rejected,
            actorId: userId,
            note: 'Application rejected',
          },
        });
      }
    }

    const updated = await this.marketplace.updateApplicationStatus(
      applicationId,
      dto.status,
    );
    return JobApplicationResponseDto.fromEntity(updated);
  }

  async listMyEngagements(
    userId: string,
  ): Promise<WorkEngagementResponseDto[]> {
    const items = await this.marketplace.listEngagementsForUser(userId);
    return items.map((item) => WorkEngagementResponseDto.fromEntity(item));
  }

  async getEngagement(
    userId: string,
    engagementId: string,
  ): Promise<WorkEngagementResponseDto> {
    const engagement = await this.requirePartyEngagement(userId, engagementId);
    return WorkEngagementResponseDto.fromEntity(engagement);
  }

  async listEngagementEvents(
    userId: string,
    engagementId: string,
  ): Promise<EngagementEventResponseDto[]> {
    const engagement = await this.requirePartyEngagement(userId, engagementId);
    return WorkEngagementResponseDto.fromEntity(engagement).events;
  }

  async transitionEngagement(
    userId: string,
    engagementId: string,
    dto: EngagementTransitionDto,
  ): Promise<WorkEngagementResponseDto> {
    const engagement = await this.requirePartyEngagement(userId, engagementId);
    const isClient = engagement.clientId === userId;
    const isProvider = engagement.providerId === userId;

    if (
      engagement.status === WorkEngagementStatus.pending_payment &&
      dto.status === WorkEngagementStatus.in_progress
    ) {
      // Settled payment advances work — Phase 5 only (server-side).
      throw new ForbiddenException(
        'Payment is required before work can start (Phase 5)',
      );
    }

    assertEngagementPartyTransition(
      engagement.status,
      dto.status,
      isClient,
      isProvider,
    );

    const note = dto.note?.trim() || undefined;
    if (dto.status === WorkEngagementStatus.disputed && !note) {
      throw new BadRequestException(
        'A note is required when declining delivery',
      );
    }

    const updated = await this.marketplace.transitionEngagement({
      id: engagementId,
      from: engagement.status,
      to: dto.status,
      actorId: userId,
      note,
    });

    await this.afterEngagementTransition(updated, userId, dto.status, note);

    return WorkEngagementResponseDto.fromEntity(updated);
  }

  /**
   * Minimal Phase 4 review bridge. After rating a completed engagement,
   * archive the work conversation for the reviewer (inbox → archived).
   */
  async createEngagementReview(
    userId: string,
    engagementId: string,
    dto: CreateEngagementReviewDto,
  ): Promise<CreateEngagementReviewResponseDto> {
    const engagement = await this.requirePartyEngagement(userId, engagementId);
    if (engagement.status !== WorkEngagementStatus.completed) {
      throw new BadRequestException(
        'Reviews are only allowed after the engagement is completed',
      );
    }

    const existing = await this.marketplace.findEngagementReview(
      engagementId,
      userId,
    );
    if (existing) {
      const conversationId =
        await this.messaging.archiveWorkConversationForReviewer(
          userId,
          engagementId,
        );
      return {
        review: EngagementReviewResponseDto.fromEntity(existing),
        conversationId,
      };
    }

    let review;
    try {
      review = await this.marketplace.createEngagementReview({
        id: randomUUID(),
        engagementId,
        reviewerId: userId,
        rating: dto.rating,
        body: dto.body?.trim() ?? '',
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        const raced = await this.marketplace.findEngagementReview(
          engagementId,
          userId,
        );
        if (raced) {
          const conversationId =
            await this.messaging.archiveWorkConversationForReviewer(
              userId,
              engagementId,
            );
          return {
            review: EngagementReviewResponseDto.fromEntity(raced),
            conversationId,
          };
        }
      }
      throw err;
    }

    const conversationId =
      await this.messaging.archiveWorkConversationForReviewer(
        userId,
        engagementId,
      );

    return {
      review: EngagementReviewResponseDto.fromEntity(review),
      conversationId,
    };
  }

  /**
   * DEV-ONLY: skip Phase 5 payment and start work chat.
   * Gated by NODE_ENV !== production AND ENABLE_DEV_START_WORK=true.
   * Temporary until payments land — see docs/DEV_START_WORK.md.
   */
  async devStartWork(
    userId: string,
    engagementId: string,
  ): Promise<WorkEngagementResponseDto> {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    const enabled = this.config.get('ENABLE_DEV_START_WORK', { infer: true });
    if (nodeEnv === 'production' || enabled !== true) {
      throw new ForbiddenException('Dev start-work is disabled');
    }

    const engagement = await this.requirePartyEngagement(userId, engagementId);
    if (engagement.status !== WorkEngagementStatus.pending_payment) {
      throw new BadRequestException(
        'Dev start-work only applies to pending_payment engagements',
      );
    }

    const updated = await this.marketplace.transitionEngagement({
      id: engagementId,
      from: WorkEngagementStatus.pending_payment,
      to: WorkEngagementStatus.in_progress,
      actorId: userId,
      note: 'DEV: start work without payment (Phase 5 pending)',
    });

    await this.messaging.onEngagementBecameInProgress(
      engagementId,
      engagement.clientId,
      engagement.providerId,
    );

    const otherPartyId =
      engagement.clientId === userId
        ? engagement.providerId
        : engagement.clientId;
    await this.notifications.createNotification({
      recipientId: otherPartyId,
      actorId: userId,
      type: NotificationType.engagement_status,
      title: (await this.users.findById(userId))?.displayName ?? 'Work update',
      body: 'started the job',
      payload: {
        screen: 'engagement',
        params: {
          engagementId,
          status: WorkEngagementStatus.in_progress,
          jobTitle: engagement.title,
        },
      },
    });

    return WorkEngagementResponseDto.fromEntity(updated);
  }

  private async afterEngagementTransition(
    engagement: {
      id: string;
      clientId: string;
      providerId: string;
      title: string;
    },
    actorId: string,
    toStatus: WorkEngagementStatus,
    note?: string,
  ): Promise<void> {
    if (toStatus === WorkEngagementStatus.in_progress) {
      await this.messaging.onEngagementBecameInProgress(
        engagement.id,
        engagement.clientId,
        engagement.providerId,
      );
    } else if (
      toStatus === WorkEngagementStatus.delivered ||
      toStatus === WorkEngagementStatus.completed ||
      toStatus === WorkEngagementStatus.disputed
    ) {
      await this.messaging.onEngagementStatusChanged(engagement.id, toStatus);
    }

    if (
      toStatus === WorkEngagementStatus.in_progress ||
      toStatus === WorkEngagementStatus.delivered ||
      toStatus === WorkEngagementStatus.completed ||
      toStatus === WorkEngagementStatus.disputed
    ) {
      const otherPartyId =
        engagement.clientId === actorId
          ? engagement.providerId
          : engagement.clientId;
      const actor = await this.users.findById(actorId);
      const summary =
        toStatus === WorkEngagementStatus.in_progress
          ? 'started the job'
          : toStatus === WorkEngagementStatus.delivered
            ? 'marked the job as delivered'
            : toStatus === WorkEngagementStatus.disputed
              ? 'declined the delivery'
              : 'completed the job';
      const disputeNote =
        toStatus === WorkEngagementStatus.disputed && note
          ? note.length > 120
            ? `${note.slice(0, 117)}...`
            : note
          : undefined;
      await this.notifications.createNotification({
        recipientId: otherPartyId,
        actorId,
        type: NotificationType.engagement_status,
        title: actor?.displayName ?? 'Work update',
        body: summary,
        payload: {
          screen: 'engagement',
          params: {
            engagementId: engagement.id,
            status: toStatus,
            jobTitle: engagement.title,
            ...(disputeNote ? { disputeNote } : {}),
          },
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Work requests — the unified Jobs inbox
  // ---------------------------------------------------------------------------

  async createServiceWorkRequest(
    userId: string,
    dto: CreateServiceWorkRequestDto,
  ): Promise<WorkRequestResponseDto> {
    await this.requireUser(userId);
    const offering = await this.marketplace.findServiceOfferingById(
      dto.serviceOfferingId,
    );
    if (!offering || offering.status !== ServiceOfferingStatus.published) {
      throw new NotFoundException('Service offering not found');
    }
    if (offering.userId === userId) {
      throw new ForbiddenException('Cannot request your own service');
    }

    const created = await this.marketplace.createWorkRequest({
      source: WorkRequestSource.service_request,
      senderUserId: userId,
      recipientUserId: offering.userId,
      clientUserId: userId,
      providerUserId: offering.userId,
      serviceOfferingId: offering.id,
      title: offering.title,
      terms: this.serviceTerms(offering, dto),
    });
    await this.notifyWorkRequestEvent({
      recipientId: offering.userId,
      actorId: userId,
      summary: 'sent you a work request',
      jobTitle: created.title,
      workRequestId: created.id,
    });
    return WorkRequestResponseDto.fromEntity(created, userId);
  }

  async createDirectWorkRequest(
    userId: string,
    dto: CreateDirectWorkRequestDto,
  ): Promise<WorkRequestResponseDto> {
    await this.requireUser(userId);
    if (dto.recipientUserId === userId) {
      throw new ForbiddenException('Cannot send a request to yourself');
    }
    const recipient = await this.users.findById(dto.recipientUserId);
    if (!recipient) throw new NotFoundException('Recipient not found');

    const created = await this.marketplace.createWorkRequest({
      source: WorkRequestSource.direct_request,
      senderUserId: userId,
      recipientUserId: dto.recipientUserId,
      clientUserId: userId,
      providerUserId: dto.recipientUserId,
      title: dto.title.trim(),
      terms: {
        title: dto.title.trim(),
        scope: dto.scope?.trim() ?? '',
        money: this.resolveMoney(dto.money, dto.price, dto.currency),
        deadline: this.resolveDeadline(dto.deadline, dto.deadlineLabel),
        notes: dto.message?.trim() ?? '',
      },
    });
    await this.notifyWorkRequestEvent({
      recipientId: dto.recipientUserId,
      actorId: userId,
      summary: 'sent you a work request',
      jobTitle: created.title,
      workRequestId: created.id,
    });
    return WorkRequestResponseDto.fromEntity(created, userId);
  }

  async listMyWorkRequests(
    userId: string,
    query: ListWorkRequestsQueryDto,
  ): Promise<WorkRequestResponseDto[]> {
    const items = await this.marketplace.listWorkRequests({
      userId,
      direction: query.direction,
      status: query.status,
    });
    return items.map((item) => WorkRequestResponseDto.fromEntity(item, userId));
  }

  async getWorkRequest(
    userId: string,
    id: string,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requirePartyWorkRequest(userId, id);
    return WorkRequestResponseDto.fromEntity(request, userId);
  }

  async markWorkRequestViewed(
    userId: string,
    id: string,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requirePartyWorkRequest(userId, id);
    const updated = await this.marketplace.markWorkRequestViewed(
      request.id,
      request.senderUserId === userId ? 'sender' : 'recipient',
    );
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  async workRequestUnreadSummary(
    userId: string,
  ): Promise<WorkRequestUnreadSummaryDto> {
    return this.marketplace.countUnreadWorkRequests(userId);
  }

  async acceptWorkRequest(
    userId: string,
    id: string,
  ): Promise<AcceptWorkRequestResponseDto> {
    const request = await this.requireRecipient(userId, id);
    // After a decline, the recipient may still accept the original terms.
    if (
      request.status !== WorkRequestStatus.pending &&
      request.status !== WorkRequestStatus.changes_declined
    ) {
      throw new ForbiddenException(
        'Only a pending or changes-declined request can be accepted',
      );
    }
    const accepted = await this.acceptRequest(
      request,
      userId,
      parseTerms(request.termsJson),
      WorkRequestEventType.accepted,
      'Request accepted — pending payment',
    );
    await this.notifyWorkRequestEvent({
      recipientId: request.senderUserId,
      actorId: userId,
      summary: 'accepted your work request',
      jobTitle: request.title,
      workRequestId: request.id,
    });
    return {
      workRequest: WorkRequestResponseDto.fromEntity(
        accepted.workRequest,
        userId,
      ),
      engagement: WorkEngagementResponseDto.fromEntity(accepted.engagement),
    };
  }

  async requestWorkRequestChanges(
    userId: string,
    id: string,
    dto: RequestWorkChangesDto,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requireRecipient(userId, id);
    if (
      request.status !== WorkRequestStatus.pending &&
      request.status !== WorkRequestStatus.changes_declined
    ) {
      throw new ForbiddenException(
        'Changes can only be requested on a pending or changes-declined request',
      );
    }
    assertWorkRequestTransition(
      request.status,
      WorkRequestStatus.changes_requested,
    );

    const patch: WorkRequestTermsPatch = dto.proposedTerms;
    if (patch.money) {
      const amount = Number(patch.money.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(
          'proposedTerms.money.amount must be greater than 0',
        );
      }
    }
    if (patch.deadline) {
      const errors = validateDeadline(patch.deadline);
      if (errors.length) {
        throw new BadRequestException(errors.join('; '));
      }
    }

    // The original snapshot is immutable — proposals live on their own column.
    const previous = parseTerms(request.termsJson);
    const proposed = mergeTerms(previous, patch);
    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: WorkRequestStatus.changes_requested,
      actorSide: 'recipient',
      event: {
        type: WorkRequestEventType.changes_requested,
        actorId: userId,
        note: dto.comment?.trim() ?? '',
        payload: toTermsChangePayload(previous, proposed),
      },
      data: {
        proposedTerms: proposed,
        proposedByUserId: userId,
        proposalComment: dto.comment?.trim() ?? '',
      },
    });
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  async acceptWorkRequestChanges(
    userId: string,
    id: string,
  ): Promise<AcceptWorkRequestResponseDto> {
    const request = await this.requireSender(userId, id);
    if (request.status !== WorkRequestStatus.changes_requested) {
      throw new ForbiddenException('No proposed changes to accept');
    }
    const agreed = request.proposedTermsJson
      ? parseTerms(request.proposedTermsJson)
      : parseTerms(request.termsJson);
    const accepted = await this.acceptRequest(
      request,
      userId,
      agreed,
      WorkRequestEventType.changes_accepted,
      'Changes accepted — pending payment',
    );
    return {
      workRequest: WorkRequestResponseDto.fromEntity(
        accepted.workRequest,
        userId,
      ),
      engagement: WorkEngagementResponseDto.fromEntity(accepted.engagement),
    };
  }

  async declineWorkRequestChanges(
    userId: string,
    id: string,
    dto: WorkRequestCommentDto,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requireSender(userId, id);
    if (request.status !== WorkRequestStatus.changes_requested) {
      throw new ForbiddenException('No proposed changes to decline');
    }
    assertWorkRequestTransition(
      request.status,
      WorkRequestStatus.changes_declined,
    );

    // Keep the declined proposal on the timeline; clear the active proposal so
    // the recipient negotiates against the original terms again.
    const original = parseTerms(request.termsJson);
    const declined = request.proposedTermsJson
      ? parseTerms(request.proposedTermsJson)
      : original;
    const note = dto.comment?.trim() ?? '';

    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: WorkRequestStatus.changes_declined,
      actorSide: 'sender',
      event: {
        type: WorkRequestEventType.changes_declined,
        actorId: userId,
        note,
        payload: toTermsChangePayload(original, declined),
      },
      data: {
        proposedTerms: null,
        proposedByUserId: null,
        proposalComment: '',
      },
    });
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  /**
   * Proposer withdraws an outstanding change request (secondary overflow action).
   * Restores the prior open status (`pending` or `changes_declined`) and clears
   * active proposal fields. Does not change turn-based primary ownership rules.
   */
  async cancelWorkRequestChanges(
    userId: string,
    id: string,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requireRecipient(userId, id);
    if (request.status !== WorkRequestStatus.changes_requested) {
      throw new ForbiddenException('No outstanding change request to withdraw');
    }
    if (request.proposedByUserId && request.proposedByUserId !== userId) {
      throw new ForbiddenException(
        'Only the party who proposed the changes can withdraw them',
      );
    }

    const priorEvent = [...request.events]
      .reverse()
      .find((e) => e.type === WorkRequestEventType.changes_requested);
    const restoreTo =
      priorEvent?.fromStatus === WorkRequestStatus.changes_declined
        ? WorkRequestStatus.changes_declined
        : WorkRequestStatus.pending;

    assertWorkRequestTransition(request.status, restoreTo);

    const original = parseTerms(request.termsJson);
    const cancelled = request.proposedTermsJson
      ? parseTerms(request.proposedTermsJson)
      : original;

    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: restoreTo,
      actorSide: 'recipient',
      event: {
        type: WorkRequestEventType.changes_cancelled,
        actorId: userId,
        note: 'Change request withdrawn',
        payload: toTermsChangePayload(original, cancelled),
      },
      data: {
        proposedTerms: null,
        proposedByUserId: null,
        proposalComment: '',
      },
    });
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  async rejectWorkRequest(
    userId: string,
    id: string,
    dto: WorkRequestCommentDto,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requirePartyWorkRequest(userId, id);
    if (!this.isOpen(request)) {
      throw new ForbiddenException('Request is no longer open');
    }

    const isRecipient = request.recipientUserId === userId;
    // Turn-based: while a proposal is under review, neither party may Reject —
    // the sender Accepts/Declines/Cancels Request; the recipient waits.
    if (request.status === WorkRequestStatus.changes_requested) {
      throw new ForbiddenException(
        'Cannot reject while changes are under review',
      );
    }
    // Recipient rejects on their turn (pending / changes_declined).
    if (!isRecipient) {
      throw new ForbiddenException(
        'Only the recipient can reject this request',
      );
    }

    assertWorkRequestTransition(request.status, WorkRequestStatus.rejected);
    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: WorkRequestStatus.rejected,
      actorSide: 'recipient',
      event: {
        type: WorkRequestEventType.rejected,
        actorId: userId,
        note: dto.comment?.trim() ?? '',
      },
      data: { rejectionComment: dto.comment?.trim() ?? '' },
    });
    await this.syncApplicationStatus(request, JobApplicationStatus.rejected);
    await this.notifyWorkRequestEvent({
      recipientId: request.senderUserId,
      actorId: userId,
      summary: 'rejected your work request',
      jobTitle: request.title,
      workRequestId: request.id,
    });
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  async withdrawWorkRequest(
    userId: string,
    id: string,
    dto: WorkRequestCommentDto,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requireSender(userId, id);
    const cancelable =
      this.isOpen(request) ||
      request.status === WorkRequestStatus.pending_payment;
    if (!cancelable) {
      throw new ForbiddenException('Request is no longer open');
    }

    // After payment settles and work starts, cancel is a future disputes concern.
    const engagementStatus = request.workEngagement?.status ?? null;
    if (
      engagementStatus &&
      engagementStatus !== WorkEngagementStatus.pending_payment
    ) {
      throw new ForbiddenException(
        'Cannot cancel after work has started. Use disputes once Payments ships.',
      );
    }

    assertWorkRequestTransition(request.status, WorkRequestStatus.withdrawn);

    if (
      request.workEngagementId &&
      engagementStatus === WorkEngagementStatus.pending_payment
    ) {
      await this.marketplace.transitionEngagement({
        id: request.workEngagementId,
        from: WorkEngagementStatus.pending_payment,
        to: WorkEngagementStatus.cancelled,
        actorId: userId,
        note: 'Work request cancelled before payment',
      });
    }

    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: WorkRequestStatus.withdrawn,
      actorSide: 'sender',
      event: {
        type: WorkRequestEventType.withdrawn,
        actorId: userId,
        note: dto.comment?.trim() ?? '',
      },
    });
    await this.syncApplicationStatus(request, JobApplicationStatus.withdrawn);
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private acceptRequest(
    request: WorkRequestWithRelations,
    actorId: string,
    agreedTerms: WorkRequestTerms,
    eventType: WorkRequestEventType,
    note: string,
  ) {
    if (request.workEngagementId) {
      throw new ConflictException('This request already has an engagement');
    }
    assertWorkRequestTransition(
      request.status,
      WorkRequestStatus.pending_payment,
    );
    return this.marketplace.acceptWorkRequestTransactional({
      workRequestId: request.id,
      actorId,
      agreedTerms,
      eventType,
      engagementSource: ENGAGEMENT_SOURCE_BY_REQUEST_SOURCE[request.source],
      note,
    });
  }

  /** Legacy applications predate work requests — create one on demand. */
  private async resolveWorkRequestForApplication(
    applicationId: string,
    actorId: string,
  ): Promise<WorkRequestWithRelations> {
    const existing =
      await this.marketplace.findWorkRequestByApplicationId(applicationId);
    if (existing) return existing;

    const application =
      await this.marketplace.findApplicationById(applicationId);
    if (!application) throw new NotFoundException('Application not found');
    const listing = await this.marketplace.findListingById(
      application.listingId,
    );
    if (!listing) throw new NotFoundException('Job listing not found');
    if (listing.posterId !== actorId) {
      throw new ForbiddenException('You do not own this listing');
    }

    return this.marketplace.createWorkRequest({
      source: WorkRequestSource.job_posting,
      senderUserId: application.applicantId,
      recipientUserId: listing.posterId,
      clientUserId: listing.posterId,
      providerUserId: application.applicantId,
      jobListingId: listing.id,
      jobApplicationId: application.id,
      title: listing.title,
      terms: this.listingTerms(listing, application.coverLetter),
    });
  }

  /**
   * A listing only carries a free-text salary label, so the amount is parsed
   * best-effort and the deadline stays flexible until someone proposes one.
   */
  private listingTerms(
    listing: {
      title: string;
      description: string;
      salaryLabel: string | null;
      location: string;
      employmentType: string;
    },
    notes: string,
  ): WorkRequestTerms {
    return {
      title: listing.title,
      scope: listing.description,
      money: moneyFromLabel(listing.salaryLabel),
      deadline: flexibleDeadline(),
      notes,
      location: listing.location,
      employmentType: listing.employmentType,
    };
  }

  /** Structured money wins; the deprecated label is only a fallback. */
  private resolveMoney(
    money: { amount: number; currency?: string } | undefined,
    legacyPrice?: string,
    legacyCurrency?: string,
  ): WorkRequestMoney | null {
    if (money) return moneyOf(money.amount, money.currency);
    return moneyFromLabel(legacyPrice, legacyCurrency);
  }

  /** Structured deadline wins; the deprecated label is only a fallback. */
  private resolveDeadline(
    deadline: Partial<WorkRequestDeadline> | undefined,
    legacyLabel?: string,
  ): WorkRequestDeadline {
    if (deadline) {
      const errors = validateDeadline(deadline);
      if (errors.length) throw new BadRequestException(errors.join('; '));
      return normalizeDeadline(deadline);
    }
    return deadlineFromLabel(legacyLabel);
  }

  private async syncApplicationStatus(
    request: WorkRequestWithRelations,
    status: JobApplicationStatus,
  ): Promise<void> {
    if (!request.jobApplicationId || !request.jobApplication) return;
    if (!OPEN_APPLICATION_STATUSES.includes(request.jobApplication.status)) {
      return;
    }
    await this.marketplace.updateApplicationStatus(
      request.jobApplicationId,
      status,
    );
  }

  private serviceTerms(
    offering: ServiceOfferingSnapshot,
    dto: CreateServiceWorkRequestDto,
  ): WorkRequestTerms {
    const tier = dto.packageTier ?? PackageTier.basic;
    const selected =
      offering.packages.find((pkg) => pkg.tier === tier) ??
      offering.packages[0] ??
      null;
    const addonIds = new Set(dto.addonIds ?? []);
    const currency = selected?.currency ?? offering.currency ?? 'SAR';
    const selectedAddons = offering.addons.filter((addon) =>
      addonIds.has(addon.id),
    );
    const addons = selectedAddons.map((addon) => ({
      id: addon.id,
      title: addon.title,
      money: moneyOf(Number(addon.price), addon.currency ?? currency),
    }));

    const total =
      Number(selected?.price ?? 0) +
      selectedAddons.reduce((sum, addon) => sum + Number(addon.price), 0);
    const override = this.resolveMoney(dto.money, dto.price, currency);

    return {
      title: offering.title,
      scope: offering.description,
      money: override ?? moneyOf(total, currency),
      deadline: this.resolveDeadline(
        dto.deadline,
        dto.deadlineLabel?.trim() || selected?.deliveryLabel,
      ),
      notes: dto.notes?.trim() ?? '',
      packageTier: selected?.tier ?? null,
      packageName: selected ? `${selected.tier} package` : '',
      addons,
    };
  }

  private isOpen(request: WorkRequestWithRelations): boolean {
    return OPEN_WORK_REQUEST_STATUSES.includes(request.status);
  }

  private async notifyWorkRequestEvent(input: {
    recipientId: string;
    actorId: string;
    /** Concise event phrase, e.g. "accepted your work request" */
    summary: string;
    jobTitle: string;
    workRequestId: string;
  }): Promise<void> {
    const actor = await this.users.findById(input.actorId);
    await this.notifications.createNotification({
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.work_request_event,
      title: actor?.displayName ?? 'Work request',
      body: input.summary,
      payload: {
        screen: 'work_request',
        params: {
          workRequestId: input.workRequestId,
          jobTitle: input.jobTitle,
        },
      },
    });
  }

  private async requireUser(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User profile not found');
  }

  private async requireOwnedListing(userId: string, listingId: string) {
    const listing = await this.marketplace.findListingById(listingId);
    if (!listing) throw new NotFoundException('Job listing not found');
    if (listing.posterId !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }
    return listing;
  }

  private async requirePartyEngagement(userId: string, engagementId: string) {
    const engagement = await this.marketplace.findEngagementById(engagementId);
    if (!engagement) throw new NotFoundException('Engagement not found');
    if (engagement.clientId !== userId && engagement.providerId !== userId) {
      throw new ForbiddenException('You are not a party to this engagement');
    }
    return engagement;
  }

  private async requirePartyWorkRequest(
    userId: string,
    id: string,
  ): Promise<WorkRequestWithRelations> {
    const request = await this.marketplace.findWorkRequestById(id);
    if (!request) throw new NotFoundException('Work request not found');
    if (request.senderUserId !== userId && request.recipientUserId !== userId) {
      throw new ForbiddenException('You are not a party to this request');
    }
    return request;
  }

  private async requireSender(
    userId: string,
    id: string,
  ): Promise<WorkRequestWithRelations> {
    const request = await this.requirePartyWorkRequest(userId, id);
    if (request.senderUserId !== userId) {
      throw new ForbiddenException('Only the sender can do this');
    }
    return request;
  }

  private async requireRecipient(
    userId: string,
    id: string,
  ): Promise<WorkRequestWithRelations> {
    const request = await this.requirePartyWorkRequest(userId, id);
    if (request.recipientUserId !== userId) {
      throw new ForbiddenException('Only the recipient can do this');
    }
    return request;
  }
}
