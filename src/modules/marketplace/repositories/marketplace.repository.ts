import {
  EmploymentType,
  JobApplication,
  JobApplicationStatus,
  JobListing,
  JobListingStatus,
  Prisma,
  User,
  WorkEngagement,
  WorkEngagementStatus,
  EngagementDetail,
  EngagementEvent,
} from '@prisma/client';

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

  createApplication(input: {
    listingId: string;
    applicantId: string;
    coverLetter?: string;
  }): Promise<JobApplicationWithRelations>;
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

  createEngagementFromApplication(input: {
    listingId: string;
    applicationId: string;
    clientId: string;
    providerId: string;
    title: string;
    coverLetter: string;
    actorId: string;
  }): Promise<WorkEngagementWithRelations>;

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

  /** Transactional accept: application → accepted, engagement created, listing → in_progress */
  acceptApplicationTransactional(input: {
    applicationId: string;
    actorId: string;
  }): Promise<{
    application: JobApplicationWithRelations;
    engagement: WorkEngagementWithRelations;
  }>;
}

export const MARKETPLACE_REPOSITORY = Symbol('MARKETPLACE_REPOSITORY');

export type { Prisma };
