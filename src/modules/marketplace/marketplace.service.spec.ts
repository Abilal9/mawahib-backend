import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AccountType,
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
} from '@prisma/client';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import { MarketplaceService } from './marketplace.service';
import { MARKETPLACE_REPOSITORY } from './repositories/marketplace.repository';
import {
  assertApplicationTransition,
  assertListingTransition,
} from './state-machines';

describe('Marketplace state machines', () => {
  it('allows draft → open (publish)', () => {
    expect(() =>
      assertListingTransition(JobListingStatus.draft, JobListingStatus.open),
    ).not.toThrow();
  });

  it('rejects invalid listing transition', () => {
    expect(() =>
      assertListingTransition(JobListingStatus.draft, JobListingStatus.closed),
    ).toThrow(BadRequestException);
  });

  it('allows application withdraw from submitted', () => {
    expect(() =>
      assertApplicationTransition(
        JobApplicationStatus.submitted,
        JobApplicationStatus.withdrawn,
      ),
    ).not.toThrow();
  });

  it('rejects application transition from accepted', () => {
    expect(() =>
      assertApplicationTransition(
        JobApplicationStatus.accepted,
        JobApplicationStatus.withdrawn,
      ),
    ).toThrow(BadRequestException);
  });
});

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  const marketplace = {
    createListing: jest.fn(),
    updateListing: jest.fn(),
    softDeleteListing: jest.fn(),
    findListingById: jest.fn(),
    listListings: jest.fn(),
    countListings: jest.fn(),
    createApplication: jest.fn(),
    findApplicationById: jest.fn(),
    findApplicationByListingAndApplicant: jest.fn(),
    listApplicationsForListing: jest.fn(),
    listApplicationsForApplicant: jest.fn(),
    updateApplicationStatus: jest.fn(),
    createEngagementFromApplication: jest.fn(),
    findEngagementById: jest.fn(),
    listEngagementsForUser: jest.fn(),
    transitionEngagement: jest.fn(),
    acceptApplicationTransactional: jest.fn(),
  };
  const users = {
    findById: jest.fn(),
  };

  const businessUser = {
    id: 'biz-1',
    accountType: AccountType.business,
  };
  const talentUser = {
    id: 'tal-1',
    accountType: AccountType.talent,
  };

  const openListing = {
    id: 'list-1',
    posterId: 'biz-1',
    title: 'Designer',
    companyName: 'Najd',
    employmentType: EmploymentType.freelance,
    location: 'Riyadh',
    salaryLabel: 'Negotiable',
    description: 'Need designer',
    skills: ['UI'],
    exploreTag: 'Design',
    status: JobListingStatus.open,
    postedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    poster: {
      id: 'biz-1',
      displayName: 'Najd',
      username: 'najd',
      accountType: AccountType.business,
      isVerified: false,
      profile: { avatarUrl: null },
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: MARKETPLACE_REPOSITORY, useValue: marketplace },
        { provide: USER_REPOSITORY, useValue: users },
      ],
    }).compile();
    service = module.get(MarketplaceService);
  });

  it('forbids talent from creating listings', async () => {
    users.findById.mockResolvedValue(talentUser);
    await expect(
      service.createListing('tal-1', {
        title: 'Job',
        employmentType: EmploymentType.freelance,
        location: 'Riyadh',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents duplicate applications', async () => {
    users.findById.mockResolvedValue(talentUser);
    marketplace.findListingById.mockResolvedValue(openListing);
    marketplace.findApplicationByListingAndApplicant.mockResolvedValue({
      id: 'app-1',
    });
    await expect(service.apply('tal-1', 'list-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('accepts application and returns engagement', async () => {
    users.findById.mockResolvedValue(businessUser);
    marketplace.findApplicationById.mockResolvedValue({
      id: 'app-1',
      listingId: 'list-1',
      applicantId: 'tal-1',
      coverLetter: 'Hi',
      status: JobApplicationStatus.submitted,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      applicant: {
        id: 'tal-1',
        displayName: 'Layla',
        username: 'layla',
        accountType: AccountType.talent,
        isVerified: false,
        profile: { avatarUrl: null, title: null },
      },
      listing: openListing,
    });
    marketplace.acceptApplicationTransactional.mockResolvedValue({
      application: {
        id: 'app-1',
        listingId: 'list-1',
        applicantId: 'tal-1',
        coverLetter: 'Hi',
        status: JobApplicationStatus.accepted,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        applicant: {
          id: 'tal-1',
          displayName: 'Layla',
          username: 'layla',
          accountType: AccountType.talent,
          isVerified: false,
          profile: { avatarUrl: null, title: null },
        },
        listing: { ...openListing, status: JobListingStatus.in_progress },
      },
      engagement: {
        id: 'eng-1',
        listingId: 'list-1',
        applicationId: 'app-1',
        serviceOfferingId: null,
        clientId: 'biz-1',
        providerId: 'tal-1',
        title: 'Designer',
        status: WorkEngagementStatus.in_progress,
        source: WorkEngagementSource.listing_application,
        dueAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        client: {
          id: 'biz-1',
          displayName: 'Najd',
          username: 'najd',
          isVerified: false,
          profile: { avatarUrl: null, title: null },
        },
        provider: {
          id: 'tal-1',
          displayName: 'Layla',
          username: 'layla',
          isVerified: false,
          profile: { avatarUrl: null, title: null },
        },
        detail: null,
        events: [],
        listing: openListing,
      },
    });

    const result = await service.patchApplication('biz-1', 'app-1', {
      status: JobApplicationStatus.accepted,
    });

    expect(result).toHaveProperty('engagement');
    expect(marketplace.acceptApplicationTransactional).toHaveBeenCalledWith({
      applicationId: 'app-1',
      actorId: 'biz-1',
    });
  });

  it('forbids non-owner from accepting applications', async () => {
    marketplace.findApplicationById.mockResolvedValue({
      id: 'app-1',
      listingId: 'list-1',
      applicantId: 'tal-1',
      coverLetter: '',
      status: JobApplicationStatus.submitted,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      applicant: {
        id: 'tal-1',
        displayName: 'Layla',
        username: 'layla',
        accountType: AccountType.talent,
        isVerified: false,
        profile: { avatarUrl: null, title: null },
      },
      listing: openListing,
    });
    await expect(
      service.patchApplication('other', 'app-1', {
        status: JobApplicationStatus.rejected,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
