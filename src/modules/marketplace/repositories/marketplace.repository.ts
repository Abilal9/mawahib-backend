import {
  EmploymentType,
  JobApplication,
  JobApplicationStatus,
  JobListing,
  JobListingStatus,
  Prisma,
  ServiceAddon,
  ServiceOffering,
  ServicePackage,
  User,
  WorkEngagement,
  WorkEngagementSource,
  WorkEngagementStatus,
  EngagementDetail,
  EngagementEvent,
  EngagementReview,
  WorkRequest,
  WorkRequestEvent,
  WorkRequestEventType,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import type { WorkRequestTerms } from '../work-request-terms';

export type JobListingWithPoster = JobListing & {
  poster: Pick<
    User,
    'id' | 'displayName' | 'username' | 'accountType' | 'isVerified'
  > & {
    profile: { avatarUrl: string | null } | null;
  };
};

export type JobApplicationWithRelations = JobApplication & {
  applicant: Pick<
    User,
    'id' | 'displayName' | 'username' | 'accountType' | 'isVerified'
  > & {
    profile: { avatarUrl: string | null; title: string | null } | null;
  };
  listing: JobListing;
};

export type WorkEngagementWithRelations = WorkEngagement & {
  client: Pick<User, 'id' | 'displayName' | 'username' | 'isVerified'> & {
    profile: { avatarUrl: string | null; title: string | null } | null;
  };
  provider: Pick<User, 'id' | 'displayName' | 'username' | 'isVerified'> & {
    profile: { avatarUrl: string | null; title: string | null } | null;
  };
  detail: EngagementDetail | null;
  events: EngagementEvent[];
  listing: JobListing | null;
};

export type WorkRequestWithRelations = WorkRequest & {
  sender: PartyUser;
  recipient: PartyUser;
  jobListing: JobListing | null;
  jobApplication: JobApplication | null;
  serviceOffering: { id: string; title: string } | null;
  workEngagement: WorkEngagement | null;
  events: WorkRequestEvent[];
};

type PartyUser = Pick<
  User,
  'id' | 'displayName' | 'username' | 'accountType' | 'isVerified'
> & {
  profile: { avatarUrl: string | null; title: string | null } | null;
};

/** Just enough of a service offering to snapshot its terms. */
export type ServiceOfferingSnapshot = ServiceOffering & {
  packages: ServicePackage[];
  addons: ServiceAddon[];
};

export interface CreateWorkRequestInput {
  source: WorkRequestSource;
  senderUserId: string;
  recipientUserId: string;
  clientUserId: string;
  providerUserId: string;
  title: string;
  terms: WorkRequestTerms;
  jobListingId?: string | null;
  jobApplicationId?: string | null;
  serviceOfferingId?: string | null;
}

export interface WorkRequestEventInput {
  type: WorkRequestEventType;
  actorId?: string | null;
  fromStatus?: WorkRequestStatus | null;
  toStatus?: WorkRequestStatus | null;
  note?: string;
  payload?: Prisma.InputJsonValue;
}

export interface ListWorkRequestsFilter {
  userId: string;
  direction: 'sent' | 'received';
  status?: WorkRequestStatus;
}

export interface WorkRequestUnreadSummary {
  sentUnread: number;
  receivedUnread: number;
}

export interface CreateListingInput {
  posterId: string;
  title: string;
  companyName?: string | null;
  employmentType: EmploymentType;
  location: string;
  salaryLabel?: string | null;
  description?: string;
  skills?: string[];
  exploreTag?: string | null;
  status?: JobListingStatus;
  postedAt?: Date | null;
}

export interface UpdateListingInput {
  title?: string;
  companyName?: string | null;
  employmentType?: EmploymentType;
  location?: string;
  salaryLabel?: string | null;
  description?: string;
  skills?: string[];
  exploreTag?: string | null;
  status?: JobListingStatus;
  postedAt?: Date | null;
}

export interface ListListingsFilter {
  status?: JobListingStatus | JobListingStatus[];
  posterId?: string;
  q?: string;
  exploreTag?: string;
  take?: number;
  skip?: number;
}

export interface MarketplaceRepository {
  createListing(input: CreateListingInput): Promise<JobListingWithPoster>;
  updateListing(
    id: string,
    input: UpdateListingInput,
  ): Promise<JobListingWithPoster>;
  softDeleteListing(id: string): Promise<void>;
  findListingById(id: string): Promise<JobListingWithPoster | null>;
  listListings(filter: ListListingsFilter): Promise<JobListingWithPoster[]>;
  countListings(filter: ListListingsFilter): Promise<number>;

  /** Application + its work request are always created together. */
  createApplicationWithWorkRequest(input: {
    listingId: string;
    applicantId: string;
    posterId: string;
    coverLetter: string;
    title: string;
    terms: WorkRequestTerms;
  }): Promise<{
    application: JobApplicationWithRelations;
    workRequest: WorkRequestWithRelations;
  }>;
  findApplicationById(id: string): Promise<JobApplicationWithRelations | null>;
  findApplicationByListingAndApplicant(
    listingId: string,
    applicantId: string,
  ): Promise<JobApplication | null>;
  listApplicationsForListing(
    listingId: string,
  ): Promise<JobApplicationWithRelations[]>;
  listApplicationsForApplicant(
    applicantId: string,
  ): Promise<JobApplicationWithRelations[]>;
  updateApplicationStatus(
    id: string,
    status: JobApplicationStatus,
  ): Promise<JobApplicationWithRelations>;

  findEngagementById(id: string): Promise<WorkEngagementWithRelations | null>;
  listEngagementsForUser(
    userId: string,
  ): Promise<WorkEngagementWithRelations[]>;
  transitionEngagement(input: {
    id: string;
    from: WorkEngagementStatus;
    to: WorkEngagementStatus;
    actorId: string;
    note?: string;
  }): Promise<WorkEngagementWithRelations>;

  findServiceOfferingById(id: string): Promise<ServiceOfferingSnapshot | null>;
  createWorkRequest(
    input: CreateWorkRequestInput,
  ): Promise<WorkRequestWithRelations>;
  findWorkRequestById(id: string): Promise<WorkRequestWithRelations | null>;
  findWorkRequestByApplicationId(
    applicationId: string,
  ): Promise<WorkRequestWithRelations | null>;
  listWorkRequests(
    filter: ListWorkRequestsFilter,
  ): Promise<WorkRequestWithRelations[]>;
  countUnreadWorkRequests(userId: string): Promise<WorkRequestUnreadSummary>;
  markWorkRequestViewed(
    id: string,
    side: 'sender' | 'recipient',
  ): Promise<WorkRequestWithRelations>;
  /** Status change + timeline event + optional negotiation fields, in one write. */
  updateWorkRequest(input: {
    id: string;
    from: WorkRequestStatus;
    to: WorkRequestStatus;
    actorSide: 'sender' | 'recipient';
    event: WorkRequestEventInput;
    data?: {
      /** Set to clear the active proposal after a decline (history lives on events). */
      proposedTerms?: WorkRequestTerms | null;
      agreedTerms?: WorkRequestTerms;
      proposedByUserId?: string | null;
      proposalComment?: string;
      rejectionComment?: string;
    };
  }): Promise<WorkRequestWithRelations>;
  /**
   * Accept: work request → pending_payment, engagement created at
   * pending_payment, linked application synced to accepted.
   */
  acceptWorkRequestTransactional(input: {
    workRequestId: string;
    actorId: string;
    agreedTerms: WorkRequestTerms;
    eventType: WorkRequestEventType;
    engagementSource: WorkEngagementSource;
    note?: string;
  }): Promise<{
    workRequest: WorkRequestWithRelations;
    engagement: WorkEngagementWithRelations;
  }>;
  /** Closing a listing rejects every still-open work request on it. */
  rejectOpenWorkRequestsForListing(input: {
    listingId: string;
    actorId: string;
    note: string;
  }): Promise<number>;

  findEngagementReview(
    engagementId: string,
    reviewerId: string,
  ): Promise<EngagementReview | null>;
  createEngagementReview(input: {
    id: string;
    engagementId: string;
    reviewerId: string;
    rating: number;
    body: string;
  }): Promise<EngagementReview>;
}

export const MARKETPLACE_REPOSITORY = Symbol('MARKETPLACE_REPOSITORY');

export type { Prisma };
