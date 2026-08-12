import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementStatus,
} from '@prisma/client';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../users/repositories/user.repository';
import {
  CreateApplicationDto,
  CreateJobListingDto,
  EngagementTransitionDto,
  ListJobListingsQueryDto,
  ListingTransitionDto,
  PatchApplicationDto,
  UpdateJobListingDto,
} from './dto/marketplace.dto';
import {
  AcceptApplicationResponseDto,
  EngagementEventResponseDto,
  JobApplicationResponseDto,
  JobListingResponseDto,
  JobListingsPageDto,
  WorkEngagementResponseDto,
} from './dto/marketplace-response.dto';
import {
  MARKETPLACE_REPOSITORY,
  type MarketplaceRepository,
} from './repositories/marketplace.repository';
import {
  OPEN_APPLICATION_STATUSES,
  assertApplicationTransition,
  assertEngagementTransition,
  assertListingTransition,
} from './state-machines';

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
    await this.requireBusiness(userId);
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
  ): Promise<JobApplicationResponseDto> {
    await this.requireTalent(userId);
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
    const created = await this.marketplace.createApplication({
      listingId,
      applicantId: userId,
      coverLetter: dto.coverLetter?.trim() || '',
    });
    return JobApplicationResponseDto.fromEntity(created);
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
      const result = await this.marketplace.acceptApplicationTransactional({
        applicationId,
        actorId: userId,
      });
      return {
        application: JobApplicationResponseDto.fromEntity(result.application),
        engagement: WorkEngagementResponseDto.fromEntity(result.engagement),
      };
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

    // Delivery: provider; completion from delivered: either party; cancel: either
    if (dto.status === WorkEngagementStatus.delivered) {
      if (engagement.providerId !== userId) {
        throw new ForbiddenException('Only the provider can mark delivered');
      }
    }
    if (
      dto.status === WorkEngagementStatus.completed &&
      engagement.status === WorkEngagementStatus.delivered
    ) {
      // either party OK
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

  private async requireBusiness(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User profile not found');
    if (user.accountType !== AccountType.business) {
      throw new ForbiddenException(
        'Only business accounts can manage listings',
      );
    }
  }

  private async requireTalent(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User profile not found');
    if (user.accountType !== AccountType.talent) {
      throw new ForbiddenException(
        'Only talent accounts can apply to listings',
      );
    }
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
}
