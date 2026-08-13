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
  PackageTier,
  ServiceOfferingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import { MarketplaceService } from './marketplace.service';
import { MARKETPLACE_REPOSITORY } from './repositories/marketplace.repository';
import {
  assertApplicationTransition,
  assertListingTransition,
  assertWorkRequestTransition,
} from './state-machines';
import {
  formatDeadline,
  formatMoney,
  mergeTerms,
  parseTerms,
  validateDeadline,
} from './work-request-terms';

describe('Work request terms', () => {
  it('parses the structured shape', () => {
    const parsed = parseTerms({
      title: 'Brand kit',
      scope: 'Logo + guidelines',
      money: { amount: 3500.005, currency: 'sar' },
      deadline: { type: 'exact_date', startDate: '2027-05-09' },
      notes: '',
      addons: [
        {
          id: 'a1',
          title: 'Cards',
          money: { amount: 280, currency: 'SAR' },
        },
      ],
    });

    // Amounts round to two decimals and the currency is upper-cased.
    expect(parsed.money).toEqual({ amount: 3500.01, currency: 'SAR' });
    expect(parsed.deadline).toEqual({
      type: 'exact_date',
      startDate: '2027-05-09',
    });
    expect(parsed.addons).toEqual([
      { id: 'a1', title: 'Cards', money: { amount: 280, currency: 'SAR' } },
    ]);
  });

  it('converts legacy price / deadline labels', () => {
    expect(
      parseTerms({
        price: 'SAR 8,000 project',
        currency: 'USD',
        deadlineLabel: '3 Weeks',
        addons: [{ id: 'a1', title: 'Cards', price: '280' }],
      }),
    ).toEqual(
      expect.objectContaining({
        money: { amount: 8000, currency: 'USD' },
        deadline: {
          type: 'duration',
          durationValue: 3,
          durationUnit: 'weeks',
        },
        addons: [
          { id: 'a1', title: 'Cards', money: { amount: 280, currency: 'USD' } },
        ],
      }),
    );
  });

  it('never invents dates for an unparseable legacy label', () => {
    expect(parseTerms({ deadlineLabel: 'Before Ramadan' }).deadline).toEqual({
      type: 'flexible',
    });
    expect(parseTerms({ price: 'Negotiable' }).money).toBeNull();
  });

  it('deep-merges money and deadline patches', () => {
    const base = parseTerms({
      money: { amount: 1000, currency: 'SAR' },
      deadline: {
        type: 'date_range',
        startDate: '2027-05-06',
        endDate: '2027-05-09',
      },
    });

    expect(mergeTerms(base, { money: { amount: 1500 } }).money).toEqual({
      amount: 1500,
      currency: 'SAR',
    });
    // Same type patches field-by-field…
    expect(
      mergeTerms(base, { deadline: { endDate: '2027-05-12' } }).deadline,
    ).toEqual({
      type: 'date_range',
      startDate: '2027-05-06',
      endDate: '2027-05-12',
    });
    // …while a new type replaces the deadline outright.
    expect(
      mergeTerms(base, {
        deadline: { type: 'duration', durationValue: 3, durationUnit: 'days' },
      }).deadline,
    ).toEqual({ type: 'duration', durationValue: 3, durationUnit: 'days' });
    expect(mergeTerms(base, { money: null }).money).toBeNull();
  });

  it('validates deadline structure', () => {
    expect(validateDeadline({ type: 'flexible' })).toEqual([]);
    expect(validateDeadline({ type: 'exact_date' })).toHaveLength(1);
    expect(
      validateDeadline({
        type: 'date_range',
        startDate: '2027-05-09',
        endDate: '2027-05-06',
      }),
    ).toHaveLength(1);
    expect(
      validateDeadline({ type: 'exact_date', startDate: '2027-02-30' }),
    ).toHaveLength(1);
    expect(
      validateDeadline({
        type: 'duration',
        durationValue: 0,
        durationUnit: 'days',
      }),
    ).toHaveLength(1);
  });

  it('formats money and deadlines for display', () => {
    expect(formatMoney({ amount: 3500, currency: 'SAR' })).toBe('SAR 3,500');
    expect(formatMoney(null)).toBe('');
    expect(
      formatDeadline({ type: 'exact_date', startDate: '2027-05-09' }),
    ).toBe('May 9, 2027');
    expect(
      formatDeadline({
        type: 'date_range',
        startDate: '2027-05-06',
        endDate: '2027-05-09',
      }),
    ).toBe('May 6 – May 9');
    expect(
      formatDeadline({
        type: 'duration',
        durationValue: 3,
        durationUnit: 'days',
      }),
    ).toBe('3 days');
    expect(
      formatDeadline({
        type: 'duration',
        durationValue: 1,
        durationUnit: 'weeks',
      }),
    ).toBe('1 week');
    expect(formatDeadline({ type: 'flexible' })).toBe('Flexible');
  });
});

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

  it('allows pending → pending_payment and changes_requested → withdrawn', () => {
    expect(() =>
      assertWorkRequestTransition(
        WorkRequestStatus.pending,
        WorkRequestStatus.pending_payment,
      ),
    ).not.toThrow();
    expect(() =>
      assertWorkRequestTransition(
        WorkRequestStatus.changes_requested,
        WorkRequestStatus.withdrawn,
      ),
    ).not.toThrow();
  });

  it('treats pending_payment as terminal for work requests', () => {
    expect(() =>
      assertWorkRequestTransition(
        WorkRequestStatus.pending_payment,
        WorkRequestStatus.rejected,
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
    createApplicationWithWorkRequest: jest.fn(),
    findApplicationById: jest.fn(),
    findApplicationByListingAndApplicant: jest.fn(),
    listApplicationsForListing: jest.fn(),
    listApplicationsForApplicant: jest.fn(),
    updateApplicationStatus: jest.fn(),
    findEngagementById: jest.fn(),
    listEngagementsForUser: jest.fn(),
    transitionEngagement: jest.fn(),
    findServiceOfferingById: jest.fn(),
    createWorkRequest: jest.fn(),
    findWorkRequestById: jest.fn(),
    findWorkRequestByApplicationId: jest.fn(),
    listWorkRequests: jest.fn(),
    countUnreadWorkRequests: jest.fn(),
    markWorkRequestViewed: jest.fn(),
    updateWorkRequest: jest.fn(),
    acceptWorkRequestTransactional: jest.fn(),
    rejectOpenWorkRequestsForListing: jest.fn(),
  };
  const users = {
    findById: jest.fn(),
  };

  const businessUser = { id: 'biz-1', accountType: AccountType.business };
  const talentUser = { id: 'tal-1', accountType: AccountType.talent };

  const openListing = {
    id: 'list-1',
    posterId: 'biz-1',
    title: 'Designer',
    companyName: 'Najd',
    employmentType: EmploymentType.freelance,
    location: 'Riyadh',
    salaryLabel: 'SAR 10,000 project',
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

  /** `expect.objectContaining` narrowed off `any` so nested matchers type-check. */
  const containing = (shape: Record<string, unknown>): unknown =>
    expect.objectContaining(shape);

  const party = (id: string, name: string) => ({
    id,
    displayName: name,
    username: name.toLowerCase(),
    accountType: AccountType.talent,
    isVerified: false,
    profile: { avatarUrl: null, title: null },
  });

  const terms = {
    title: 'Designer',
    scope: 'Need designer',
    money: { amount: 10000, currency: 'SAR' },
    deadline: { type: 'flexible' as const },
    notes: 'Hi',
  };

  const workRequest = (overrides: Record<string, unknown> = {}) => ({
    id: 'wr-1',
    source: WorkRequestSource.job_posting,
    senderUserId: 'tal-1',
    recipientUserId: 'biz-1',
    clientUserId: 'biz-1',
    providerUserId: 'tal-1',
    jobListingId: 'list-1',
    jobApplicationId: 'app-1',
    serviceOfferingId: null,
    workEngagementId: null,
    title: 'Designer',
    status: WorkRequestStatus.pending,
    termsJson: terms,
    proposedTermsJson: null,
    agreedTermsJson: null,
    proposedByUserId: null,
    proposalComment: '',
    rejectionComment: '',
    senderLastViewedAt: new Date(),
    recipientLastViewedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sender: party('tal-1', 'Layla'),
    recipient: party('biz-1', 'Najd'),
    jobListing: openListing,
    jobApplication: {
      id: 'app-1',
      status: JobApplicationStatus.submitted,
    },
    serviceOffering: null,
    workEngagement: null,
    events: [],
    ...overrides,
  });

  const engagement = {
    id: 'eng-1',
    listingId: 'list-1',
    applicationId: 'app-1',
    serviceOfferingId: null,
    clientId: 'biz-1',
    providerId: 'tal-1',
    title: 'Designer',
    status: WorkEngagementStatus.pending_payment,
    source: WorkEngagementSource.listing_application,
    dueAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: party('biz-1', 'Najd'),
    provider: party('tal-1', 'Layla'),
    detail: null,
    events: [],
    listing: openListing,
  };

  const application = {
    id: 'app-1',
    listingId: 'list-1',
    applicantId: 'tal-1',
    coverLetter: 'Hi',
    status: JobApplicationStatus.submitted,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    applicant: party('tal-1', 'Layla'),
    listing: openListing,
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

  describe('listings', () => {
    it('lets any authenticated account post a listing', async () => {
      users.findById.mockResolvedValue(talentUser);
      marketplace.createListing.mockResolvedValue(openListing);

      const result = await service.createListing('tal-1', {
        title: 'Job',
        employmentType: EmploymentType.freelance,
        location: 'Riyadh',
      });

      expect(result.id).toBe('list-1');
      expect(marketplace.createListing).toHaveBeenCalledWith(
        expect.objectContaining({ posterId: 'tal-1' }),
      );
    });

    it('rejects open work requests when a listing is closed', async () => {
      marketplace.findListingById.mockResolvedValue(openListing);
      marketplace.updateListing.mockResolvedValue({
        ...openListing,
        status: JobListingStatus.closed,
      });
      marketplace.rejectOpenWorkRequestsForListing.mockResolvedValue(2);

      await service.transitionListing('biz-1', 'list-1', {
        status: JobListingStatus.closed,
      });

      expect(marketplace.rejectOpenWorkRequestsForListing).toHaveBeenCalledWith(
        {
          listingId: 'list-1',
          actorId: 'biz-1',
          note: 'Listing was closed',
        },
      );
    });

    it('does not touch work requests when a listing is archived', async () => {
      marketplace.findListingById.mockResolvedValue(openListing);
      marketplace.updateListing.mockResolvedValue({
        ...openListing,
        status: JobListingStatus.archived,
      });

      await service.transitionListing('biz-1', 'list-1', {
        status: JobListingStatus.archived,
      });

      expect(
        marketplace.rejectOpenWorkRequestsForListing,
      ).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('creates an application and a pending work request with listing terms', async () => {
      users.findById.mockResolvedValue(talentUser);
      marketplace.findListingById.mockResolvedValue(openListing);
      marketplace.findApplicationByListingAndApplicant.mockResolvedValue(null);
      marketplace.createApplicationWithWorkRequest.mockResolvedValue({
        application,
        workRequest: workRequest(),
      });

      const result = await service.apply('tal-1', 'list-1', {
        coverLetter: 'Hi',
      });

      expect(result.workRequest.status).toBe(WorkRequestStatus.pending);
      expect(result.workRequest.direction).toBe('sent');
      expect(marketplace.createApplicationWithWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          listingId: 'list-1',
          applicantId: 'tal-1',
          posterId: 'biz-1',
          terms: containing({
            title: 'Designer',
            scope: 'Need designer',
            // The listing carries only a salary label; the amount is parsed out.
            money: { amount: 10000, currency: 'SAR' },
            deadline: { type: 'flexible' },
            notes: 'Hi',
          }),
        }),
      );
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

    it('prevents applying to your own listing', async () => {
      users.findById.mockResolvedValue(businessUser);
      marketplace.findListingById.mockResolvedValue(openListing);

      await expect(service.apply('biz-1', 'list-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('prevents applying to a closed listing', async () => {
      users.findById.mockResolvedValue(talentUser);
      marketplace.findListingById.mockResolvedValue({
        ...openListing,
        status: JobListingStatus.closed,
      });

      await expect(service.apply('tal-1', 'list-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('accepting an application', () => {
    it('creates an engagement at pending_payment and leaves the listing open', async () => {
      marketplace.findApplicationById.mockResolvedValue(application);
      marketplace.findWorkRequestByApplicationId.mockResolvedValue(
        workRequest(),
      );
      marketplace.acceptWorkRequestTransactional.mockResolvedValue({
        workRequest: workRequest({
          status: WorkRequestStatus.pending_payment,
          workEngagementId: 'eng-1',
          agreedTermsJson: terms,
        }),
        engagement,
      });

      const result = await service.patchApplication('biz-1', 'app-1', {
        status: JobApplicationStatus.accepted,
      });

      expect(result).toHaveProperty('engagement');
      expect(marketplace.acceptWorkRequestTransactional).toHaveBeenCalledWith(
        expect.objectContaining({
          workRequestId: 'wr-1',
          actorId: 'biz-1',
          engagementSource: WorkEngagementSource.listing_application,
          eventType: WorkRequestEventType.accepted,
        }),
      );
      expect(marketplace.updateListing).not.toHaveBeenCalled();
    });

    it('creates a work request on the fly for legacy applications', async () => {
      marketplace.findApplicationById.mockResolvedValue(application);
      marketplace.findWorkRequestByApplicationId.mockResolvedValue(null);
      marketplace.findListingById.mockResolvedValue(openListing);
      marketplace.createWorkRequest.mockResolvedValue(workRequest());
      marketplace.acceptWorkRequestTransactional.mockResolvedValue({
        workRequest: workRequest({
          status: WorkRequestStatus.pending_payment,
        }),
        engagement,
      });

      await service.patchApplication('biz-1', 'app-1', {
        status: JobApplicationStatus.accepted,
      });

      expect(marketplace.createWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          source: WorkRequestSource.job_posting,
          jobApplicationId: 'app-1',
        }),
      );
    });

    it('forbids non-owner from reviewing applications', async () => {
      marketplace.findApplicationById.mockResolvedValue(application);

      await expect(
        service.patchApplication('other', 'app-1', {
          status: JobApplicationStatus.rejected,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects the linked work request when the application is rejected', async () => {
      marketplace.findApplicationById.mockResolvedValue(application);
      marketplace.findWorkRequestByApplicationId.mockResolvedValue(
        workRequest(),
      );
      marketplace.updateApplicationStatus.mockResolvedValue({
        ...application,
        status: JobApplicationStatus.rejected,
      });

      await service.patchApplication('biz-1', 'app-1', {
        status: JobApplicationStatus.rejected,
      });

      expect(marketplace.updateWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          to: WorkRequestStatus.rejected,
          actorSide: 'recipient',
        }),
      );
    });
  });

  describe('service and direct requests', () => {
    const offering = {
      id: 'svc-1',
      userId: 'tal-1',
      title: 'Logo & Brand Identity',
      description: 'Full identity',
      category: 'Branding',
      status: ServiceOfferingStatus.published,
      currency: 'SAR',
      packages: [
        {
          id: 'pkg-1',
          tier: PackageTier.standard,
          price: 1900,
          currency: 'SAR',
          deliveryLabel: '10 days',
        },
      ],
      addons: [
        { id: 'add-1', title: 'Business cards', price: 280, currency: 'SAR' },
      ],
    };

    it('snapshots package and addons on a service request', async () => {
      users.findById.mockResolvedValue(businessUser);
      marketplace.findServiceOfferingById.mockResolvedValue(offering);
      marketplace.createWorkRequest.mockResolvedValue(
        workRequest({
          source: WorkRequestSource.service_request,
          senderUserId: 'biz-1',
          recipientUserId: 'tal-1',
          clientUserId: 'biz-1',
          providerUserId: 'tal-1',
        }),
      );

      await service.createServiceWorkRequest('biz-1', {
        serviceOfferingId: 'svc-1',
        packageTier: PackageTier.standard,
        addonIds: ['add-1'],
        notes: 'Launch in March',
      });

      expect(marketplace.createWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          source: WorkRequestSource.service_request,
          senderUserId: 'biz-1',
          recipientUserId: 'tal-1',
          clientUserId: 'biz-1',
          providerUserId: 'tal-1',
          terms: containing({
            packageTier: PackageTier.standard,
            // Package price + selected add-ons, and the delivery label parsed
            // into a structured duration.
            money: { amount: 2180, currency: 'SAR' },
            deadline: {
              type: 'duration',
              durationValue: 10,
              durationUnit: 'days',
            },
            addons: [
              {
                id: 'add-1',
                title: 'Business cards',
                money: { amount: 280, currency: 'SAR' },
              },
            ],
          }),
        }),
      );
    });

    it('forbids requesting your own service', async () => {
      users.findById.mockResolvedValue(talentUser);
      marketplace.findServiceOfferingById.mockResolvedValue(offering);

      await expect(
        service.createServiceWorkRequest('tal-1', {
          serviceOfferingId: 'svc-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates a direct request with the sender as client', async () => {
      users.findById.mockResolvedValue(businessUser);
      marketplace.createWorkRequest.mockResolvedValue(
        workRequest({ source: WorkRequestSource.direct_request }),
      );

      await service.createDirectWorkRequest('biz-1', {
        recipientUserId: 'tal-1',
        title: 'Poster illustration',
        scope: 'One key visual',
        money: { amount: 2500, currency: 'SAR' },
        deadline: { type: 'exact_date', startDate: '2027-05-09' },
        message: 'Are you free?',
      });

      expect(marketplace.createWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          source: WorkRequestSource.direct_request,
          senderUserId: 'biz-1',
          clientUserId: 'biz-1',
          providerUserId: 'tal-1',
          terms: containing({
            title: 'Poster illustration',
            money: { amount: 2500, currency: 'SAR' },
            deadline: { type: 'exact_date', startDate: '2027-05-09' },
            notes: 'Are you free?',
          }),
        }),
      );
    });

    it('falls back to the legacy price / deadline labels', async () => {
      users.findById.mockResolvedValue(businessUser);
      marketplace.createWorkRequest.mockResolvedValue(
        workRequest({ source: WorkRequestSource.direct_request }),
      );

      await service.createDirectWorkRequest('biz-1', {
        recipientUserId: 'tal-1',
        title: 'Poster illustration',
        price: 'SAR 2,500',
        deadlineLabel: '2 weeks',
      });

      expect(marketplace.createWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: containing({
            money: { amount: 2500, currency: 'SAR' },
            deadline: {
              type: 'duration',
              durationValue: 2,
              durationUnit: 'weeks',
            },
          }),
        }),
      );
    });

    it('rejects a direct request with an incoherent deadline', async () => {
      users.findById.mockResolvedValue(businessUser);

      await expect(
        service.createDirectWorkRequest('biz-1', {
          recipientUserId: 'tal-1',
          title: 'Poster illustration',
          deadline: { type: 'date_range', startDate: '2027-05-09' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids sending a direct request to yourself', async () => {
      users.findById.mockResolvedValue(businessUser);

      await expect(
        service.createDirectWorkRequest('biz-1', {
          recipientUserId: 'biz-1',
          title: 'Self',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('work request negotiation', () => {
    it('accepts a pending request as the recipient', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());
      marketplace.acceptWorkRequestTransactional.mockResolvedValue({
        workRequest: workRequest({
          status: WorkRequestStatus.pending_payment,
        }),
        engagement,
      });

      const result = await service.acceptWorkRequest('biz-1', 'wr-1');

      expect(result.engagement.status).toBe(
        WorkEngagementStatus.pending_payment,
      );
      expect(result.workRequest.status).toBe(WorkRequestStatus.pending_payment);
    });

    it('forbids the sender from accepting their own request', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());

      await expect(
        service.acceptWorkRequest('tal-1', 'wr-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stores proposed terms when the recipient requests changes', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());
      marketplace.updateWorkRequest.mockResolvedValue(
        workRequest({
          status: WorkRequestStatus.changes_requested,
          proposedTermsJson: {
            ...terms,
            money: { amount: 12000, currency: 'SAR' },
          },
          proposedByUserId: 'biz-1',
          proposalComment: 'Bigger scope',
        }),
      );

      const result = await service.requestWorkRequestChanges('biz-1', 'wr-1', {
        proposedTerms: {
          money: { amount: 12000 },
          deadline: {
            type: 'duration',
            durationValue: 3,
            durationUnit: 'weeks',
          },
        },
        comment: 'Bigger scope',
      });

      expect(result.status).toBe(WorkRequestStatus.changes_requested);
      expect(marketplace.updateWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          to: WorkRequestStatus.changes_requested,
          actorSide: 'recipient',
          // Both sides of the change stay on the event so history is auditable.
          event: containing({
            payload: {
              previousTerms: containing({
                money: { amount: 10000, currency: 'SAR' },
                deadline: { type: 'flexible' },
              }),
              proposedTerms: containing({
                money: { amount: 12000, currency: 'SAR' },
              }),
            },
          }),
          data: containing({
            proposedByUserId: 'biz-1',
            proposalComment: 'Bigger scope',
            // Untouched fields keep their original snapshot values, and the
            // currency is inherited from the original money.
            proposedTerms: containing({
              title: 'Designer',
              money: { amount: 12000, currency: 'SAR' },
              deadline: {
                type: 'duration',
                durationValue: 3,
                durationUnit: 'weeks',
              },
            }),
          }),
        }),
      );
    });

    it('rejects a proposal with a non-positive amount', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());

      await expect(
        service.requestWorkRequestChanges('biz-1', 'wr-1', {
          proposedTerms: { money: { amount: 0 } },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a proposal with an incoherent deadline', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());

      await expect(
        service.requestWorkRequestChanges('biz-1', 'wr-1', {
          proposedTerms: {
            deadline: { type: 'duration', durationUnit: 'days' },
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids the sender from requesting changes', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());

      await expect(
        service.requestWorkRequestChanges('tal-1', 'wr-1', {
          proposedTerms: { money: { amount: 1 } },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts proposed changes as the sender and agrees on proposed terms', async () => {
      const proposed = { ...terms, money: { amount: 12000, currency: 'SAR' } };
      marketplace.findWorkRequestById.mockResolvedValue(
        workRequest({
          status: WorkRequestStatus.changes_requested,
          proposedTermsJson: proposed,
          proposedByUserId: 'biz-1',
        }),
      );
      marketplace.acceptWorkRequestTransactional.mockResolvedValue({
        workRequest: workRequest({
          status: WorkRequestStatus.pending_payment,
          agreedTermsJson: proposed,
        }),
        engagement,
      });

      await service.acceptWorkRequestChanges('tal-1', 'wr-1');

      expect(marketplace.acceptWorkRequestTransactional).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'tal-1',
          eventType: WorkRequestEventType.changes_accepted,
          agreedTerms: containing({
            money: { amount: 12000, currency: 'SAR' },
          }),
        }),
      );
    });

    it('declines proposed changes as the sender', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(
        workRequest({ status: WorkRequestStatus.changes_requested }),
      );
      marketplace.updateWorkRequest.mockResolvedValue(
        workRequest({ status: WorkRequestStatus.rejected }),
      );

      await service.declineWorkRequestChanges('tal-1', 'wr-1', {
        comment: 'Too expensive',
      });

      expect(marketplace.updateWorkRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          to: WorkRequestStatus.rejected,
          actorSide: 'sender',
          event: containing({
            type: WorkRequestEventType.changes_declined,
          }),
        }),
      );
    });

    it('rejects as the recipient and syncs the linked application', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());
      marketplace.updateWorkRequest.mockResolvedValue(
        workRequest({ status: WorkRequestStatus.rejected }),
      );

      await service.rejectWorkRequest('biz-1', 'wr-1', { comment: 'Not now' });

      expect(marketplace.updateApplicationStatus).toHaveBeenCalledWith(
        'app-1',
        JobApplicationStatus.rejected,
      );
    });

    it('withdraws as the sender and syncs the linked application', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());
      marketplace.updateWorkRequest.mockResolvedValue(
        workRequest({ status: WorkRequestStatus.withdrawn }),
      );

      await service.withdrawWorkRequest('tal-1', 'wr-1', {});

      expect(marketplace.updateApplicationStatus).toHaveBeenCalledWith(
        'app-1',
        JobApplicationStatus.withdrawn,
      );
    });

    it('refuses to withdraw a request that is already accepted', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(
        workRequest({ status: WorkRequestStatus.pending_payment }),
      );

      await expect(
        service.withdrawWorkRequest('tal-1', 'wr-1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids strangers from reading a request', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());

      await expect(
        service.getWorkRequest('someone-else', 'wr-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('inbox', () => {
    it('marks the viewer side as read', async () => {
      marketplace.findWorkRequestById.mockResolvedValue(workRequest());
      marketplace.markWorkRequestViewed.mockResolvedValue(
        workRequest({ recipientLastViewedAt: new Date() }),
      );

      await service.markWorkRequestViewed('biz-1', 'wr-1');

      expect(marketplace.markWorkRequestViewed).toHaveBeenCalledWith(
        'wr-1',
        'recipient',
      );
    });

    it('flags a request as unread when it changed after the last view', async () => {
      const viewed = new Date('2026-01-01T00:00:00Z');
      const changed = new Date('2026-01-02T00:00:00Z');
      marketplace.listWorkRequests.mockResolvedValue([
        workRequest({
          recipientLastViewedAt: viewed,
          updatedAt: changed,
        }),
      ]);

      const [item] = await service.listMyWorkRequests('biz-1', {
        direction: 'received',
      });

      expect(item?.unread).toBe(true);
      expect(item?.direction).toBe('received');
      expect(item?.counterparty?.id).toBe('tal-1');
    });

    it('returns the unread summary', async () => {
      marketplace.countUnreadWorkRequests.mockResolvedValue({
        sentUnread: 1,
        receivedUnread: 3,
      });

      await expect(service.workRequestUnreadSummary('biz-1')).resolves.toEqual({
        sentUnread: 1,
        receivedUnread: 3,
      });
    });
  });

  describe('engagements', () => {
    it('does not let a party fake payment by starting the work', async () => {
      marketplace.findEngagementById.mockResolvedValue(engagement);

      await expect(
        service.transitionEngagement('biz-1', 'eng-1', {
          status: WorkEngagementStatus.in_progress,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only lets the provider deliver in-progress work', async () => {
      marketplace.findEngagementById.mockResolvedValue({
        ...engagement,
        status: WorkEngagementStatus.in_progress,
      });

      await expect(
        service.transitionEngagement('biz-1', 'eng-1', {
          status: WorkEngagementStatus.delivered,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      marketplace.transitionEngagement.mockResolvedValue({
        ...engagement,
        status: WorkEngagementStatus.delivered,
      });
      await expect(
        service.transitionEngagement('tal-1', 'eng-1', {
          status: WorkEngagementStatus.delivered,
        }),
      ).resolves.toBeDefined();
    });
  });
});
