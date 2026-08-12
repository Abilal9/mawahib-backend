import { Injectable, NotFoundException } from '@nestjs/common';
import {
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  CreateListingInput,
  JobApplicationWithRelations,
  JobListingWithPoster,
  ListListingsFilter,
  MarketplaceRepository,
  UpdateListingInput,
  WorkEngagementWithRelations,
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

  createApplication(input: {
    listingId: string;
    applicantId: string;
    coverLetter?: string;
  }): Promise<JobApplicationWithRelations> {
    return this.prisma.jobApplication.create({
      data: {
        listingId: input.listingId,
        applicantId: input.applicantId,
        coverLetter: input.coverLetter ?? '',
        status: JobApplicationStatus.submitted,
      },
      include: {
        applicant: { select: { ...partySelect, accountType: true } },
        listing: true,
      },
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

  createEngagementFromApplication(input: {
    listingId: string;
    applicationId: string;
    clientId: string;
    providerId: string;
    title: string;
    coverLetter: string;
    actorId: string;
  }): Promise<WorkEngagementWithRelations> {
    return this.prisma.workEngagement.create({
      data: {
        listingId: input.listingId,
        applicationId: input.applicationId,
        clientId: input.clientId,
        providerId: input.providerId,
        title: input.title,
        status: WorkEngagementStatus.in_progress,
        source: WorkEngagementSource.listing_application,
        detail: {
          create: {
            serviceName: input.title,
            packageName: '',
            coverLetter: input.coverLetter,
            notes: '',
          },
        },
        events: {
          create: {
            fromStatus: null,
            toStatus: WorkEngagementStatus.in_progress,
            actorId: input.actorId,
            note: 'Engagement created from accepted application',
          },
        },
      },
      include: this.engagementInclude(),
    });
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
    await this.prisma.engagementEvent.create({
      data: {
        engagementId: input.id,
        fromStatus: input.from,
        toStatus: input.to,
        actorId: input.actorId,
        note: input.note ?? '',
      },
    });
    return this.prisma.workEngagement.update({
      where: { id: input.id },
      data: { status: input.to },
      include: this.engagementInclude(),
    });
  }

  async acceptApplicationTransactional(input: {
    applicationId: string;
    actorId: string;
  }): Promise<{
    application: JobApplicationWithRelations;
    engagement: WorkEngagementWithRelations;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.jobApplication.findFirst({
        where: { id: input.applicationId, deletedAt: null },
        include: {
          applicant: { select: { ...partySelect, accountType: true } },
          listing: true,
        },
      });
      if (!application || application.listing.deletedAt) {
        throw new NotFoundException('Application not found');
      }

      const updatedApp = await tx.jobApplication.update({
        where: { id: application.id },
        data: { status: JobApplicationStatus.accepted },
        include: {
          applicant: { select: { ...partySelect, accountType: true } },
          listing: true,
        },
      });

      await tx.jobListing.update({
        where: { id: application.listingId },
        data: { status: JobListingStatus.in_progress },
      });

      const engagement = await tx.workEngagement.create({
        data: {
          listingId: application.listingId,
          applicationId: application.id,
          clientId: application.listing.posterId,
          providerId: application.applicantId,
          title: application.listing.title,
          status: WorkEngagementStatus.in_progress,
          source: WorkEngagementSource.listing_application,
          detail: {
            create: {
              serviceName: application.listing.title,
              packageName: '',
              coverLetter: application.coverLetter,
              notes: '',
              locationCity: application.listing.location,
            },
          },
          events: {
            create: {
              fromStatus: null,
              toStatus: WorkEngagementStatus.in_progress,
              actorId: input.actorId,
              note: 'Created by accepting application',
            },
          },
        },
        include: this.engagementInclude(),
      });

      return {
        application: updatedApp,
        engagement,
      };
    });
  }
}
