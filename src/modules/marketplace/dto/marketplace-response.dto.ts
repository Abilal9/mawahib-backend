import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import type {
  JobApplicationWithRelations,
  JobListingWithPoster,
  WorkEngagementWithRelations,
  WorkRequestWithRelations,
} from '../repositories/marketplace.repository';
import { parseTerms, type WorkRequestTerms } from '../work-request-terms';

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
  currency!: string;
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
    dto.currency = entity.currency;
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
            currency: listing.currency ?? 'SAR',
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

export class WorkRequestPartyDto {
  id!: string;
  displayName!: string;
  username!: string;
  accountType!: string;
  isVerified!: boolean;
  avatarUrl!: string | null;
  title!: string | null;
}

export class WorkRequestEventResponseDto {
  id!: string;
  type!: WorkRequestEventType;
  actorId!: string | null;
  fromStatus!: WorkRequestStatus | null;
  toStatus!: WorkRequestStatus | null;
  note!: string;
  payload!: unknown;
  createdAt!: string;
}

export class WorkRequestResponseDto {
  id!: string;
  source!: WorkRequestSource;
  status!: WorkRequestStatus;
  title!: string;
  senderUserId!: string;
  recipientUserId!: string;
  clientUserId!: string;
  providerUserId!: string;
  jobListingId!: string | null;
  jobApplicationId!: string | null;
  serviceOfferingId!: string | null;
  serviceTitle!: string | null;
  workEngagementId!: string | null;
  workEngagementStatus!: WorkEngagementStatus | null;
  terms!: WorkRequestTerms;
  proposedTerms!: WorkRequestTerms | null;
  agreedTerms!: WorkRequestTerms | null;
  proposedByUserId!: string | null;
  proposalComment!: string;
  rejectionComment!: string;
  sender!: WorkRequestPartyDto;
  recipient!: WorkRequestPartyDto;
  /** Viewer-relative helpers so the Jobs inbox does not recompute roles */
  direction!: 'sent' | 'received' | null;
  counterparty!: WorkRequestPartyDto | null;
  unread!: boolean;
  events!: WorkRequestEventResponseDto[];
  createdAt!: string;
  updatedAt!: string;

  static fromEntity(
    entity: WorkRequestWithRelations,
    viewerId?: string,
  ): WorkRequestResponseDto {
    const dto = new WorkRequestResponseDto();
    dto.id = entity.id;
    dto.source = entity.source;
    dto.status = entity.status;
    dto.title = entity.title;
    dto.senderUserId = entity.senderUserId;
    dto.recipientUserId = entity.recipientUserId;
    dto.clientUserId = entity.clientUserId;
    dto.providerUserId = entity.providerUserId;
    dto.jobListingId = entity.jobListingId;
    dto.jobApplicationId = entity.jobApplicationId;
    dto.serviceOfferingId = entity.serviceOfferingId;
    dto.serviceTitle = entity.serviceOffering?.title ?? null;
    dto.workEngagementId = entity.workEngagementId;
    dto.workEngagementStatus = entity.workEngagement?.status ?? null;
    dto.terms = parseTerms(entity.termsJson);
    dto.proposedTerms = entity.proposedTermsJson
      ? parseTerms(entity.proposedTermsJson)
      : null;
    dto.agreedTerms = entity.agreedTermsJson
      ? parseTerms(entity.agreedTermsJson)
      : null;
    dto.proposedByUserId = entity.proposedByUserId;
    dto.proposalComment = entity.proposalComment;
    dto.rejectionComment = entity.rejectionComment;
    dto.sender = toWorkRequestParty(entity.sender);
    dto.recipient = toWorkRequestParty(entity.recipient);

    const isSender = viewerId === entity.senderUserId;
    const isRecipient = viewerId === entity.recipientUserId;
    dto.direction = isSender ? 'sent' : isRecipient ? 'received' : null;
    dto.counterparty = isSender
      ? dto.recipient
      : isRecipient
        ? dto.sender
        : null;
    const lastViewedAt = isSender
      ? entity.senderLastViewedAt
      : isRecipient
        ? entity.recipientLastViewedAt
        : null;
    dto.unread =
      dto.direction !== null &&
      (!lastViewedAt || entity.updatedAt.getTime() > lastViewedAt.getTime());

    dto.events = (entity.events ?? []).map((event) => ({
      id: event.id,
      type: event.type,
      actorId: event.actorId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      payload: event.payload ?? null,
      createdAt: event.createdAt.toISOString(),
    }));
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    return dto;
  }
}

function toWorkRequestParty(
  party: WorkRequestWithRelations['sender'],
): WorkRequestPartyDto {
  return {
    id: party.id,
    displayName: party.displayName,
    username: party.username,
    accountType: party.accountType,
    isVerified: party.isVerified,
    avatarUrl: party.profile?.avatarUrl ?? null,
    title: party.profile?.title ?? null,
  };
}

export class WorkRequestUnreadSummaryDto {
  sentUnread!: number;
  receivedUnread!: number;
}

export class ApplyToListingResponseDto {
  application!: JobApplicationResponseDto;
  workRequest!: WorkRequestResponseDto;
}

export class AcceptApplicationResponseDto {
  application!: JobApplicationResponseDto;
  engagement!: WorkEngagementResponseDto;
  workRequest!: WorkRequestResponseDto;
}

export class AcceptWorkRequestResponseDto {
  workRequest!: WorkRequestResponseDto;
  engagement!: WorkEngagementResponseDto;
}

export class EngagementReviewResponseDto {
  id!: string;
  engagementId!: string;
  reviewerId!: string;
  rating!: number;
  body!: string;
  createdAt!: string;

  static fromEntity(entity: {
    id: string;
    engagementId: string;
    reviewerId: string;
    rating: number;
    body: string;
    createdAt: Date;
  }): EngagementReviewResponseDto {
    const dto = new EngagementReviewResponseDto();
    dto.id = entity.id;
    dto.engagementId = entity.engagementId;
    dto.reviewerId = entity.reviewerId;
    dto.rating = entity.rating;
    dto.body = entity.body;
    dto.createdAt = entity.createdAt.toISOString();
    return dto;
  }
}

export class CreateEngagementReviewResponseDto {
  review!: EngagementReviewResponseDto;
  conversationId!: string | null;
}
