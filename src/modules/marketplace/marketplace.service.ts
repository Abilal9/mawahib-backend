import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JobApplicationStatus,
  JobListingStatus,
  PackageTier,
  ServiceOfferingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../users/repositories/user.repository';
import {
  CreateApplicationDto,
  CreateDirectWorkRequestDto,
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
  EngagementEventResponseDto,
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
  assertApplicationTransition,
  assertEngagementTransition,
  assertListingTransition,
  assertWorkRequestTransition,
} from './state-machines';
import {
  mergeTerms,
  parseTerms,
  toJson,
  type WorkRequestTerms,
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
    if (dto.status === JobListingStatus.closed) {
      // Closing withdraws the offer: open requests are rejected, but accepted
      // work (engagements) keeps running.
      await this.marketplace.rejectOpenWorkRequestsForListing({
        listingId,
        actorId: userId,
        note: 'Listing was closed',
      });
    }
    return JobListingResponseDto.fromEntity(updated);
  }

  async softDeleteListing(userId: string, listingId: string): Promise<void> {
    await this.requireOwnedListing(userId, listingId);
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
      terms: {
        title: listing.title,
        scope: listing.description,
        price: listing.salaryLabel ?? '',
        currency: 'SAR',
        deadlineLabel: 'Flexible',
        notes: coverLetter,
        location: listing.location,
        employmentType: listing.employmentType,
      },
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
        'Application accepted — awaiting payment',
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
    assertEngagementTransition(engagement.status, dto.status);

    if (
      engagement.status === WorkEngagementStatus.pending_payment &&
      dto.status === WorkEngagementStatus.in_progress
    ) {
      // Only a settled payment may start the work — that lands in Phase 5.
      throw new ForbiddenException(
        'Payment is required before work can start (Phase 5)',
      );
    }

    if (dto.status === WorkEngagementStatus.delivered) {
      if (engagement.providerId !== userId) {
        throw new ForbiddenException('Only the provider can mark delivered');
      }
      if (engagement.status !== WorkEngagementStatus.in_progress) {
        throw new ForbiddenException(
          'Only in-progress work can be marked delivered',
        );
      }
    }

    const updated = await this.marketplace.transitionEngagement({
      id: engagementId,
      from: engagement.status,
      to: dto.status,
      actorId: userId,
      note: dto.note,
    });
    return WorkEngagementResponseDto.fromEntity(updated);
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
        price: dto.price?.trim() ?? '',
        currency: dto.currency?.trim() || 'SAR',
        deadlineLabel: dto.deadlineLabel?.trim() || 'Flexible',
        notes: dto.message?.trim() ?? '',
      },
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
    if (request.status !== WorkRequestStatus.pending) {
      throw new ForbiddenException('Only a pending request can be accepted');
    }
    const accepted = await this.acceptRequest(
      request,
      userId,
      parseTerms(request.termsJson),
      WorkRequestEventType.accepted,
      'Request accepted — awaiting payment',
    );
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
    if (request.status !== WorkRequestStatus.pending) {
      throw new ForbiddenException(
        'Changes can only be requested on a pending request',
      );
    }
    assertWorkRequestTransition(
      request.status,
      WorkRequestStatus.changes_requested,
    );

    const proposed = mergeTerms(parseTerms(request.termsJson), {
      ...dto.proposedTerms,
    });
    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: WorkRequestStatus.changes_requested,
      actorSide: 'recipient',
      event: {
        type: WorkRequestEventType.changes_requested,
        actorId: userId,
        note: dto.comment?.trim() ?? '',
        payload: toJson(proposed),
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
      'Proposed changes accepted — awaiting payment',
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
    assertWorkRequestTransition(request.status, WorkRequestStatus.rejected);
    // Proposed terms stay on the row so both sides can still read the offer.
    const updated = await this.marketplace.updateWorkRequest({
      id: request.id,
      from: request.status,
      to: WorkRequestStatus.rejected,
      actorSide: 'sender',
      event: {
        type: WorkRequestEventType.changes_declined,
        actorId: userId,
        note: dto.comment?.trim() ?? '',
      },
      data: { rejectionComment: dto.comment?.trim() ?? '' },
    });
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  async rejectWorkRequest(
    userId: string,
    id: string,
    dto: WorkRequestCommentDto,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requireRecipient(userId, id);
    if (!this.isOpen(request)) {
      throw new ForbiddenException('Request is no longer open');
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
    return WorkRequestResponseDto.fromEntity(updated, userId);
  }

  async withdrawWorkRequest(
    userId: string,
    id: string,
    dto: WorkRequestCommentDto,
  ): Promise<WorkRequestResponseDto> {
    const request = await this.requireSender(userId, id);
    if (!this.isOpen(request)) {
      throw new ForbiddenException('Request is no longer open');
    }
    assertWorkRequestTransition(request.status, WorkRequestStatus.withdrawn);
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
      terms: {
        title: listing.title,
        scope: listing.description,
        price: listing.salaryLabel ?? '',
        currency: 'SAR',
        deadlineLabel: 'Flexible',
        notes: application.coverLetter,
        location: listing.location,
        employmentType: listing.employmentType,
      },
    });
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
    const addons = offering.addons
      .filter((addon) => addonIds.has(addon.id))
      .map((addon) => ({
        id: addon.id,
        title: addon.title,
        price: addon.price.toString(),
      }));

    const currency = selected?.currency ?? offering.currency ?? 'SAR';
    const total =
      Number(selected?.price ?? 0) +
      offering.addons
        .filter((addon) => addonIds.has(addon.id))
        .reduce((sum, addon) => sum + Number(addon.price), 0);

    return {
      title: offering.title,
      scope: offering.description,
      price:
        dto.price?.trim() || `${currency} ${total.toLocaleString('en-US')}`,
      currency,
      deadlineLabel:
        dto.deadlineLabel?.trim() || selected?.deliveryLabel || 'Flexible',
      notes: dto.notes?.trim() ?? '',
      packageTier: selected?.tier ?? null,
      packageName: selected ? `${selected.tier} package` : '',
      addons,
    };
  }

  private isOpen(request: WorkRequestWithRelations): boolean {
    return (
      request.status === WorkRequestStatus.pending ||
      request.status === WorkRequestStatus.changes_requested
    );
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
