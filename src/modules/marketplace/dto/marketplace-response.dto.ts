import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
} from '@prisma/client';
import type {
  JobApplicationWithRelations,
  JobListingWithPoster,
  WorkEngagementWithRelations,
} from '../repositories/marketplace.repository';

export class PosterSummaryDto {
  id!: string;
  displayName!: string;
  username!: string;
  accountType!: string;
  isVerified!: boolean;
  avatarUrl!: string | null;
}

export class JobListingResponseDto {
  id!: string;
  posterId!: string;
  title!: string;
  companyName!: string | null;
  employmentType!: EmploymentType;
  location!: string;
  salaryLabel!: string | null;
  description!: string;
  skills!: string[];
  exploreTag!: string | null;
  status!: JobListingStatus;
  postedAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  poster!: PosterSummaryDto;

  static fromEntity(entity: JobListingWithPoster): JobListingResponseDto {
    const dto = new JobListingResponseDto();
    dto.id = entity.id;
    dto.posterId = entity.posterId;
    dto.title = entity.title;
    dto.companyName = entity.companyName;
    dto.employmentType = entity.employmentType;
    dto.location = entity.location;
    dto.salaryLabel = entity.salaryLabel;
    dto.description = entity.description;
    dto.skills = entity.skills;
    dto.exploreTag = entity.exploreTag;
    dto.status = entity.status;
    dto.postedAt = entity.postedAt?.toISOString() ?? null;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    dto.poster = {
      id: entity.poster.id,
      displayName: entity.poster.displayName,
      username: entity.poster.username,
      accountType: entity.poster.accountType,
      isVerified: entity.poster.isVerified,
      avatarUrl: entity.poster.profile?.avatarUrl ?? null,
    };
    return dto;
  }
}

export class JobListingsPageDto {
  items!: JobListingResponseDto[];
  total!: number;
  take!: number;
  skip!: number;
}

export class PartySummaryDto {
  id!: string;
  displayName!: string;
  username!: string;
  isVerified!: boolean;
  avatarUrl!: string | null;
  title!: string | null;
}

export class JobApplicationResponseDto {
  id!: string;
  listingId!: string;
  applicantId!: string;
  coverLetter!: string;
  status!: JobApplicationStatus;
  createdAt!: string;
  updatedAt!: string;
  applicant!: PartySummaryDto & { accountType: string };
  listing!: JobListingResponseDto | null;

  static fromEntity(
    entity: JobApplicationWithRelations,
  ): JobApplicationResponseDto {
    const dto = new JobApplicationResponseDto();
    dto.id = entity.id;
    dto.listingId = entity.listingId;
    dto.applicantId = entity.applicantId;
    dto.coverLetter = entity.coverLetter;
    dto.status = entity.status;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    dto.applicant = {
      id: entity.applicant.id,
      displayName: entity.applicant.displayName,
      username: entity.applicant.username,
      isVerified: entity.applicant.isVerified,
      avatarUrl: entity.applicant.profile?.avatarUrl ?? null,
      title: entity.applicant.profile?.title ?? null,
      accountType: entity.applicant.accountType,
    };
    // listing may not include poster; map minimal fields if poster missing
    const listing = entity.listing as JobListingWithPoster | undefined;
    dto.listing = listing?.poster
      ? JobListingResponseDto.fromEntity(listing)
      : listing
        ? {
            id: listing.id,
            posterId: listing.posterId,
            title: listing.title,
            companyName: listing.companyName,
            employmentType: listing.employmentType,
            location: listing.location,
            salaryLabel: listing.salaryLabel,
            description: listing.description,
            skills: listing.skills,
            exploreTag: listing.exploreTag,
            status: listing.status,
            postedAt: listing.postedAt?.toISOString() ?? null,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
            poster: {
              id: listing.posterId,
              displayName: '',
              username: '',
              accountType: 'business',
              isVerified: false,
              avatarUrl: null,
            },
          }
        : null;
    return dto;
  }
}

export class EngagementDetailResponseDto {
  serviceName!: string;
  packageName!: string;
  packagePrice!: string;
  currency!: string;
  addons!: unknown;
  deadlineLabel!: string | null;
  locationUrl!: string | null;
  locationCity!: string | null;
  locationCountry!: string | null;
  notes!: string;
  coverLetter!: string;
}

export class EngagementEventResponseDto {
  id!: string;
  fromStatus!: WorkEngagementStatus | null;
  toStatus!: WorkEngagementStatus;
  actorId!: string | null;
  note!: string;
  createdAt!: string;
}

export class WorkEngagementResponseDto {
  id!: string;
  listingId!: string | null;
  applicationId!: string | null;
  serviceOfferingId!: string | null;
  clientId!: string;
  providerId!: string;
  title!: string;
  status!: WorkEngagementStatus;
  source!: WorkEngagementSource;
  dueAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  client!: PartySummaryDto;
  provider!: PartySummaryDto;
  detail!: EngagementDetailResponseDto | null;
  events!: EngagementEventResponseDto[];

  static fromEntity(
    entity: WorkEngagementWithRelations,
  ): WorkEngagementResponseDto {
    const dto = new WorkEngagementResponseDto();
    dto.id = entity.id;
    dto.listingId = entity.listingId;
    dto.applicationId = entity.applicationId;
    dto.serviceOfferingId = entity.serviceOfferingId;
    dto.clientId = entity.clientId;
    dto.providerId = entity.providerId;
    dto.title = entity.title;
    dto.status = entity.status;
    dto.source = entity.source;
    dto.dueAt = entity.dueAt?.toISOString() ?? null;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    dto.client = {
      id: entity.client.id,
      displayName: entity.client.displayName,
      username: entity.client.username,
      isVerified: entity.client.isVerified,
      avatarUrl: entity.client.profile?.avatarUrl ?? null,
      title: entity.client.profile?.title ?? null,
    };
    dto.provider = {
      id: entity.provider.id,
      displayName: entity.provider.displayName,
      username: entity.provider.username,
      isVerified: entity.provider.isVerified,
      avatarUrl: entity.provider.profile?.avatarUrl ?? null,
      title: entity.provider.profile?.title ?? null,
    };
    dto.detail = entity.detail
      ? {
          serviceName: entity.detail.serviceName,
          packageName: entity.detail.packageName,
          packagePrice: entity.detail.packagePrice.toString(),
          currency: entity.detail.currency,
          addons: entity.detail.addons,
          deadlineLabel: entity.detail.deadlineLabel,
          locationUrl: entity.detail.locationUrl,
          locationCity: entity.detail.locationCity,
          locationCountry: entity.detail.locationCountry,
          notes: entity.detail.notes,
          coverLetter: entity.detail.coverLetter,
        }
      : null;
    dto.events = (entity.events ?? []).map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    }));
    return dto;
  }
}

export class AcceptApplicationResponseDto {
  application!: JobApplicationResponseDto;
  engagement!: WorkEngagementResponseDto;
}
