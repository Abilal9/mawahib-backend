import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  Prisma,
  PrismaClient,
  WorkEngagementSource,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestSource,
  WorkRequestStatus,
} from '@prisma/client';
import { seedId } from './ids';

type ListingSeed = {
  label: string;
  title: string;
  companyName: string;
  employmentType: EmploymentType;
  location: string;
  salaryLabel: string;
  description: string;
  skills: string[];
  exploreTag: string;
  status: JobListingStatus;
  postedDaysAgo: number | null;
};

const LISTINGS: ListingSeed[] = [
  {
    label: 'brand-designer',
    title: 'Brand Designer for Hospitality Launch',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.freelance,
    location: 'Jeddah (Hybrid)',
    salaryLabel: 'SAR 8,000 – 12,000 project',
    description:
      'We need a brand designer to refine identity applications for a Red Sea hospitality launch — signage, menu system, and guest welcome kit.',
    skills: ['Branding', 'Packaging', 'Figma'],
    exploreTag: 'Design',
    status: JobListingStatus.open,
    postedDaysAgo: 2,
  },
  {
    label: 'product-ui',
    title: 'Product UI Designer — Fintech Mobile',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.contract,
    location: 'Riyadh',
    salaryLabel: 'SAR 18,000 / month',
    description:
      'Contract role to redesign onboarding and transfer flows for a consumer wallet. Strong Figma systems experience required.',
    skills: ['UI Design', 'Design Systems', 'Prototyping'],
    exploreTag: 'Tech',
    status: JobListingStatus.open,
    postedDaysAgo: 5,
  },
  {
    label: 'social-lead',
    title: 'Social Content Lead (Ramadan)',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.part_time,
    location: 'Remote — KSA',
    salaryLabel: 'SAR 6,000 / month',
    description:
      'Part-time content lead for a retail Ramadan campaign. Own calendar, creatives direction, and talent briefs.',
    skills: ['Social', 'Art Direction', 'Content'],
    exploreTag: 'Design',
    status: JobListingStatus.open,
    postedDaysAgo: 1,
  },
  {
    label: 'motion-gig',
    title: 'Motion Designer — Launch Teaser',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.gig,
    location: 'Remote',
    salaryLabel: 'SAR 3,500 flat',
    description:
      'Short motion teaser (15–20s) for a product launch. Deliver After Effects project + MP4.',
    skills: ['Motion', 'After Effects'],
    exploreTag: 'Design',
    status: JobListingStatus.open,
    postedDaysAgo: 3,
  },
  {
    label: 'fulltime-art',
    title: 'Senior Art Director',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.full_time,
    location: 'Jeddah',
    salaryLabel: 'SAR 22,000 – 28,000 / month',
    description:
      'Full-time art director to lead campaign craft across hospitality and retail accounts.',
    skills: ['Art Direction', 'Campaign Design', 'Leadership'],
    exploreTag: 'Design',
    status: JobListingStatus.draft,
    postedDaysAgo: null,
  },
  {
    label: 'archived-illustrator',
    title: 'Illustrator — Seasonal Menu',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.freelance,
    location: 'Remote',
    salaryLabel: 'SAR 4,500 project',
    description: 'Seasonal illustration set for F&B menus (archived after season).',
    skills: ['Illustration', 'Food'],
    exploreTag: 'Food',
    status: JobListingStatus.archived,
    postedDaysAgo: 40,
  },
  {
    label: 'closed-web',
    title: 'Website Visual Refresh',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.contract,
    location: 'Riyadh',
    salaryLabel: 'SAR 15,000 project',
    description: 'Visual refresh for a studio microsite. Role closed after hire.',
    skills: ['UI Design', 'Web'],
    exploreTag: 'Tech',
    status: JobListingStatus.closed,
    postedDaysAgo: 25,
  },
  {
    label: 'in-progress-brand',
    title: 'Identity System for Specialty Coffee',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.freelance,
    location: 'Riyadh',
    salaryLabel: 'SAR 10,000 project',
    description:
      'Build a complete identity system for a specialty coffee brand. Currently in progress with hired talent.',
    skills: ['Branding', 'Packaging'],
    exploreTag: 'Design',
    status: JobListingStatus.in_progress,
    postedDaysAgo: 18,
  },
  {
    label: 'completed-ui',
    title: 'Savings App UI Kit',
    companyName: 'Najd Creative Studio',
    employmentType: EmploymentType.contract,
    location: 'Remote',
    salaryLabel: 'SAR 12,000 project',
    description: 'Completed engagement — mobile UI kit delivered and accepted.',
    skills: ['UI Design', 'Figma'],
    exploreTag: 'Tech',
    status: JobListingStatus.completed,
    postedDaysAgo: 60,
  },
];

/**
 * Mirrors `src/modules/marketplace/work-request-terms.ts`. The seed stays
 * dependency-free on purpose, so the shape is duplicated rather than imported.
 */
type Money = { amount: number; currency: string };

type Deadline = {
  type: 'exact_date' | 'date_range' | 'duration' | 'flexible';
  startDate?: string;
  endDate?: string;
  durationValue?: number;
  durationUnit?: 'days' | 'weeks' | 'months';
};

type Terms = {
  title: string;
  scope: string;
  money: Money | null;
  deadline: Deadline;
  notes: string;
  location?: string;
  employmentType?: string;
  packageTier?: string;
  packageName?: string;
  addons?: Array<{ id: string; title: string; money: Money }>;
};

const sar = (amount: number): Money => ({ amount, currency: 'SAR' });

const flexible: Deadline = { type: 'flexible' };

const duration = (
  durationValue: number,
  durationUnit: 'days' | 'weeks' | 'months',
): Deadline => ({ type: 'duration', durationValue, durationUnit });

const exactDate = (startDate: string): Deadline => ({
  type: 'exact_date',
  startDate,
});

const dateRange = (startDate: string, endDate: string): Deadline => ({
  type: 'date_range',
  startDate,
  endDate,
});

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Mirrors `formatDeadline` so engagement detail labels match the API. */
function deadlineLabel(deadline: Deadline): string {
  const day = (iso: string, withYear: boolean) => {
    const [year, month, date] = iso.split('-').map(Number) as [
      number,
      number,
      number,
    ];
    const label = `${MONTHS[month - 1]} ${date}`;
    return withYear ? `${label}, ${year}` : label;
  };
  switch (deadline.type) {
    case 'exact_date':
      return deadline.startDate ? day(deadline.startDate, true) : 'Flexible';
    case 'date_range': {
      if (!deadline.startDate || !deadline.endDate) return 'Flexible';
      const sameYear =
        deadline.startDate.slice(0, 4) === deadline.endDate.slice(0, 4);
      return `${day(deadline.startDate, !sameYear)} – ${day(
        deadline.endDate,
        !sameYear,
      )}`;
    }
    case 'duration': {
      const value = deadline.durationValue ?? 0;
      const unit = deadline.durationUnit ?? 'days';
      return `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
    }
    default:
      return 'Flexible';
  }
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** YYYY-MM-DD, `n` days from today — keeps seeded deadlines in the future. */
function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function clearMarketplaceForUsers(
  prisma: PrismaClient,
  talentId: string,
  businessId: string,
) {
  const userIds = [talentId, businessId];
  await prisma.workRequest.deleteMany({
    where: {
      OR: [
        { senderUserId: { in: userIds } },
        { recipientUserId: { in: userIds } },
      ],
    },
  });
  await prisma.workEngagement.deleteMany({
    where: {
      OR: [{ clientId: { in: userIds } }, { providerId: { in: userIds } }],
    },
  });
  await prisma.jobApplication.deleteMany({
    where: {
      OR: [{ applicantId: talentId }, { listing: { posterId: businessId } }],
    },
  });
  await prisma.jobListing.deleteMany({ where: { posterId: businessId } });
}

export async function seedMarketplace(
  prisma: PrismaClient,
  talentId: string,
  businessId: string,
) {
  await clearMarketplaceForUsers(prisma, talentId, businessId);

  const listingIds: Record<string, string> = {};
  for (const listing of LISTINGS) {
    const id = seedId(`listing:${listing.label}`);
    listingIds[listing.label] = id;
    await prisma.jobListing.create({
      data: {
        id,
        posterId: businessId,
        title: listing.title,
        companyName: listing.companyName,
        employmentType: listing.employmentType,
        location: listing.location,
        salaryLabel: listing.salaryLabel,
        description: listing.description,
        skills: listing.skills,
        exploreTag: listing.exploreTag,
        status: listing.status,
        postedAt:
          listing.postedDaysAgo == null
            ? null
            : daysAgo(listing.postedDaysAgo),
      },
    });
  }

  const listingByLabel = new Map(LISTINGS.map((l) => [l.label, l]));

  type AppSeed = {
    label: string;
    listing: string;
    status: JobApplicationStatus;
    coverLetter: string;
    daysAgo: number;
    /** Work request state for the same negotiation */
    requestStatus: WorkRequestStatus;
    deadline: Deadline;
    proposal?: { money?: Money; deadline?: Deadline; comment: string };
    rejectionComment?: string;
    engagementLabel?: string;
  };

  const applications: AppSeed[] = [
    {
      label: 'app-brand-submitted',
      listing: 'brand-designer',
      status: JobApplicationStatus.submitted,
      coverLetter:
        'I recently shipped a hospitality identity with bilingual guidelines and would love to support your Red Sea launch.',
      daysAgo: 1,
      requestStatus: WorkRequestStatus.pending,
      // Launch date is fixed, so the request carries an exact date.
      deadline: exactDate(isoDaysFromNow(45)),
    },
    {
      label: 'app-ui-review',
      listing: 'product-ui',
      status: JobApplicationStatus.under_review,
      coverLetter:
        'Attached portfolio includes a full fintech savings flow with design tokens and prototype.',
      daysAgo: 3,
      requestStatus: WorkRequestStatus.changes_requested,
      deadline: duration(6, 'months'),
      proposal: {
        money: sar(15000),
        deadline: duration(3, 'months'),
        comment:
          'We can move ahead at 15,000 per month for a three month engagement — does that work?',
      },
    },
    {
      label: 'app-social-rejected',
      listing: 'social-lead',
      status: JobApplicationStatus.rejected,
      coverLetter:
        'I can lead the Ramadan calendar and deliver bilingual social systems end-to-end.',
      daysAgo: 4,
      requestStatus: WorkRequestStatus.rejected,
      deadline: flexible,
      rejectionComment: 'We filled this role internally — thank you!',
    },
    {
      label: 'app-motion-submitted',
      listing: 'motion-gig',
      status: JobApplicationStatus.submitted,
      coverLetter:
        'Happy to deliver a 15s teaser with AE source. Recent launch work in my portfolio.',
      daysAgo: 0,
      requestStatus: WorkRequestStatus.pending,
      deadline: duration(10, 'days'),
    },
    {
      label: 'app-coffee-accepted',
      listing: 'in-progress-brand',
      status: JobApplicationStatus.accepted,
      coverLetter:
        'I can own the coffee identity system — packaging, guidelines, and launch assets.',
      daysAgo: 16,
      requestStatus: WorkRequestStatus.pending_payment,
      deadline: dateRange(isoDaysFromNow(-14), isoDaysFromNow(21)),
      engagementLabel: 'eng-coffee-active',
    },
    {
      label: 'app-savings-accepted',
      listing: 'completed-ui',
      status: JobApplicationStatus.accepted,
      coverLetter:
        'Ready to deliver a polished savings UI kit with handoff-ready components.',
      daysAgo: 55,
      requestStatus: WorkRequestStatus.pending_payment,
      deadline: duration(6, 'weeks'),
      engagementLabel: 'eng-savings-delivered',
    },
    {
      label: 'app-web-completed',
      listing: 'closed-web',
      status: JobApplicationStatus.accepted,
      coverLetter: 'Delivered a full visual refresh with component library.',
      daysAgo: 30,
      requestStatus: WorkRequestStatus.pending_payment,
      deadline: exactDate(isoDaysFromNow(-20)),
      engagementLabel: 'eng-web-completed',
    },
  ];

  const applicationIds: Record<string, string> = {};
  for (const app of applications) {
    const id = seedId(`application:${app.label}`);
    applicationIds[app.label] = id;
    await prisma.jobApplication.create({
      data: {
        id,
        listingId: listingIds[app.listing]!,
        applicantId: talentId,
        coverLetter: app.coverLetter,
        status: app.status,
        createdAt: daysAgo(app.daysAgo),
        updatedAt: daysAgo(app.daysAgo),
      },
    });
  }

  const appSeed = (label: string) =>
    applications.find((a) => a.label === label)!;

  // Engagements — accepted work. Payment is Phase 5, so freshly accepted work
  // sits at pending_payment while older seeded work is already running.
  await createEngagement(prisma, {
    label: 'eng-coffee-active',
    listingLabel: 'in-progress-brand',
    applicationLabel: 'app-coffee-accepted',
    source: WorkEngagementSource.listing_application,
    clientId: businessId,
    providerId: talentId,
    title: 'Identity System for Specialty Coffee',
    status: WorkEngagementStatus.in_progress,
    coverLetter: appSeed('app-coffee-accepted').coverLetter,
    locationCity: 'Riyadh',
    packagePrice: 10000,
    deadlineLabel: deadlineLabel(appSeed('app-coffee-accepted').deadline),
    events: [
      {
        to: WorkEngagementStatus.pending_payment,
        note: 'Engagement created from accepted work request',
        daysAgo: 15,
      },
      {
        from: WorkEngagementStatus.pending_payment,
        to: WorkEngagementStatus.in_progress,
        note: 'Payment settled — work started',
        daysAgo: 14,
      },
    ],
  });

  await createEngagement(prisma, {
    label: 'eng-savings-delivered',
    listingLabel: 'completed-ui',
    applicationLabel: 'app-savings-accepted',
    source: WorkEngagementSource.listing_application,
    clientId: businessId,
    providerId: talentId,
    title: 'Savings App UI Kit',
    status: WorkEngagementStatus.delivered,
    coverLetter: appSeed('app-savings-accepted').coverLetter,
    locationCity: 'Remote',
    packagePrice: 12000,
    deadlineLabel: deadlineLabel(appSeed('app-savings-accepted').deadline),
    events: [
      {
        to: WorkEngagementStatus.in_progress,
        note: 'Engagement started after acceptance',
        daysAgo: 50,
      },
      {
        from: WorkEngagementStatus.in_progress,
        to: WorkEngagementStatus.delivered,
        note: 'UI kit delivered for review',
        daysAgo: 10,
        actor: 'provider',
      },
    ],
  });

  await createEngagement(prisma, {
    label: 'eng-web-completed',
    listingLabel: 'closed-web',
    applicationLabel: 'app-web-completed',
    source: WorkEngagementSource.listing_application,
    clientId: businessId,
    providerId: talentId,
    title: 'Website Visual Refresh',
    status: WorkEngagementStatus.completed,
    coverLetter: 'Delivered a full visual refresh with component library.',
    locationCity: 'Riyadh',
    packagePrice: 15000,
    deadlineLabel: deadlineLabel(appSeed('app-web-completed').deadline),
    events: [
      {
        to: WorkEngagementStatus.in_progress,
        note: 'Engagement created from accepted application',
        daysAgo: 28,
      },
      {
        from: WorkEngagementStatus.in_progress,
        to: WorkEngagementStatus.delivered,
        note: 'Final screens and assets delivered',
        daysAgo: 22,
        actor: 'provider',
      },
      {
        from: WorkEngagementStatus.delivered,
        to: WorkEngagementStatus.completed,
        note: 'Client accepted delivery',
        daysAgo: 20,
        actor: 'client',
      },
    ],
  });

  // Job-posting work requests mirror every application (Layla → Najd).
  for (const app of applications) {
    const listing = listingByLabel.get(app.listing)!;
    const baseTerms: Terms = {
      title: listing.title,
      scope: listing.description,
      // Listing salary labels are free text; the request carries the number.
      money: sar(priceToNumber(listing.salaryLabel)),
      deadline: app.deadline,
      notes: app.coverLetter,
      location: listing.location,
      employmentType: listing.employmentType,
    };
    await createWorkRequest(prisma, {
      label: `wr-${app.label}`,
      source: WorkRequestSource.job_posting,
      senderUserId: talentId,
      recipientUserId: businessId,
      clientUserId: businessId,
      providerUserId: talentId,
      jobListingId: listingIds[app.listing]!,
      jobApplicationId: applicationIds[app.label]!,
      engagementLabel: app.engagementLabel,
      title: listing.title,
      status: app.requestStatus,
      terms: baseTerms,
      proposal: app.proposal
        ? {
            terms: {
              ...baseTerms,
              money: app.proposal.money ?? baseTerms.money,
              deadline: app.proposal.deadline ?? baseTerms.deadline,
            },
            byUserId: businessId,
            comment: app.proposal.comment,
          }
        : undefined,
      rejectionComment: app.rejectionComment,
      createdDaysAgo: app.daysAgo + 1,
      updatedDaysAgo: app.daysAgo,
    });
  }

  const serviceRequests = await seedServiceRequests(
    prisma,
    talentId,
    businessId,
  );
  const directRequests = await seedDirectRequests(prisma, talentId, businessId);

  return {
    listings: LISTINGS.length,
    applications: applications.length,
    engagements: 3 + serviceRequests.engagements + directRequests.engagements,
    workRequests:
      applications.length + serviceRequests.requests + directRequests.requests,
  };
}

/** Service requests — a buyer books a published service package. */
async function seedServiceRequests(
  prisma: PrismaClient,
  talentId: string,
  businessId: string,
) {
  const laylaService = (label: string) =>
    seedId(`service:${talentId}:${label}`);
  const najdService = (label: string) =>
    seedId(`service:${businessId}:${label}`);

  type ServiceRequestSeed = {
    label: string;
    offeringId: string;
    clientId: string;
    providerId: string;
    title: string;
    scope: string;
    packageTier: string;
    money: Money;
    deadline: Deadline;
    notes: string;
    addons?: Array<{ id: string; title: string; money: Money }>;
    status: WorkRequestStatus;
    proposal?: { money?: Money; deadline?: Deadline; comment: string };
    rejectionComment?: string;
    engagement?: {
      label: string;
      status: WorkEngagementStatus;
      events: EngagementEventSeed[];
    };
    createdDaysAgo: number;
    updatedDaysAgo: number;
  };

  const seeds: ServiceRequestSeed[] = [
    {
      label: 'svc-brand-pending',
      offeringId: laylaService('brand-identity'),
      clientId: businessId,
      providerId: talentId,
      title: 'Logo & Brand Identity',
      scope:
        'Logo concepts, color system, and brand guidelines tailored for bilingual markets.',
      packageTier: 'standard',
      money: sar(2180),
      deadline: duration(10, 'days'),
      notes:
        'This is for a new coworking brand in Jeddah. Business cards add-on included.',
      addons: [
        { id: 'addon-cards', title: 'Business card design', money: sar(280) },
      ],
      status: WorkRequestStatus.pending,
      createdDaysAgo: 2,
      updatedDaysAgo: 2,
    },
    {
      label: 'svc-mobile-changes',
      offeringId: laylaService('mobile-ui'),
      clientId: businessId,
      providerId: talentId,
      title: 'Mobile UI Design',
      scope: 'App screens, interactive prototype, and developer handoff.',
      packageTier: 'standard',
      money: sar(3000),
      deadline: duration(14, 'days'),
      notes: 'Eight screens for a delivery app MVP.',
      status: WorkRequestStatus.changes_requested,
      proposal: {
        money: sar(3600),
        deadline: duration(18, 'days'),
        comment:
          'Eight screens plus the prototype needs 18 days at 3,600 — happy to start Sunday.',
      },
      createdDaysAgo: 6,
      updatedDaysAgo: 4,
    },
    {
      label: 'svc-sprint-rejected',
      offeringId: najdService('content-sprint'),
      clientId: talentId,
      providerId: businessId,
      title: 'Two-Week Content Sprint',
      scope: 'Fast content production for seasonal pushes.',
      packageTier: 'basic',
      money: sar(4200),
      deadline: dateRange(isoDaysFromNow(4), isoDaysFromNow(18)),
      notes: 'Need help covering an overflow retainer for one of my clients.',
      status: WorkRequestStatus.rejected,
      rejectionComment: 'Our production slots are full this month.',
      createdDaysAgo: 12,
      updatedDaysAgo: 11,
    },
    {
      label: 'svc-social-awaiting-payment',
      offeringId: laylaService('social-pack'),
      clientId: businessId,
      providerId: talentId,
      title: 'Social Content Pack',
      scope: 'Monthly social creatives for Instagram and LinkedIn.',
      packageTier: 'standard',
      money: sar(1700),
      deadline: duration(7, 'days'),
      notes: 'Retail client, Arabic and English captions.',
      status: WorkRequestStatus.pending_payment,
      engagement: {
        label: 'eng-svc-social',
        status: WorkEngagementStatus.pending_payment,
        events: [
          {
            to: WorkEngagementStatus.pending_payment,
            note: 'Request accepted — pending payment',
            daysAgo: 1,
          },
        ],
      },
      createdDaysAgo: 3,
      updatedDaysAgo: 1,
    },
    {
      label: 'svc-brand-active',
      offeringId: laylaService('brand-identity'),
      clientId: businessId,
      providerId: talentId,
      title: 'Logo & Brand Identity — Premium',
      scope: 'Full brand kit, social templates, and source files.',
      packageTier: 'premium',
      money: sar(3800),
      deadline: exactDate(isoDaysFromNow(9)),
      notes: 'Hospitality sub-brand for the Red Sea project.',
      status: WorkRequestStatus.pending_payment,
      engagement: {
        label: 'eng-svc-brand',
        status: WorkEngagementStatus.in_progress,
        events: [
          {
            to: WorkEngagementStatus.pending_payment,
            note: 'Request accepted — pending payment',
            daysAgo: 20,
          },
          {
            from: WorkEngagementStatus.pending_payment,
            to: WorkEngagementStatus.in_progress,
            note: 'Payment settled — work started',
            daysAgo: 19,
          },
        ],
      },
      createdDaysAgo: 22,
      updatedDaysAgo: 19,
    },
    {
      label: 'svc-mobile-completed',
      offeringId: laylaService('mobile-ui'),
      clientId: businessId,
      providerId: talentId,
      title: 'Mobile UI Design — Basic',
      scope: 'Three key screens and the Figma file.',
      packageTier: 'basic',
      money: sar(1400),
      deadline: flexible,
      notes: 'Concept screens for an internal pitch.',
      status: WorkRequestStatus.pending_payment,
      engagement: {
        label: 'eng-svc-mobile',
        status: WorkEngagementStatus.completed,
        events: [
          {
            to: WorkEngagementStatus.pending_payment,
            note: 'Request accepted — pending payment',
            daysAgo: 45,
          },
          {
            from: WorkEngagementStatus.pending_payment,
            to: WorkEngagementStatus.in_progress,
            note: 'Payment settled — work started',
            daysAgo: 44,
          },
          {
            from: WorkEngagementStatus.in_progress,
            to: WorkEngagementStatus.delivered,
            note: 'Screens delivered',
            daysAgo: 38,
            actor: 'provider',
          },
          {
            from: WorkEngagementStatus.delivered,
            to: WorkEngagementStatus.completed,
            note: 'Client accepted delivery',
            daysAgo: 36,
            actor: 'client',
          },
        ],
      },
      createdDaysAgo: 47,
      updatedDaysAgo: 36,
    },
  ];

  let engagements = 0;
  for (const seed of seeds) {
    const terms: Terms = {
      title: seed.title,
      scope: seed.scope,
      money: seed.money,
      deadline: seed.deadline,
      notes: seed.notes,
      packageTier: seed.packageTier,
      packageName: `${seed.packageTier} package`,
      addons: seed.addons ?? [],
    };

    if (seed.engagement) {
      engagements += 1;
      await createEngagement(prisma, {
        label: seed.engagement.label,
        serviceOfferingId: seed.offeringId,
        source: WorkEngagementSource.service_request,
        clientId: seed.clientId,
        providerId: seed.providerId,
        title: seed.title,
        status: seed.engagement.status,
        coverLetter: seed.notes,
        packageName: `${seed.packageTier} package`,
        packagePrice: seed.money.amount,
        deadlineLabel: deadlineLabel(seed.deadline),
        events: seed.engagement.events,
      });
    }

    await createWorkRequest(prisma, {
      label: `wr-${seed.label}`,
      source: WorkRequestSource.service_request,
      senderUserId: seed.clientId,
      recipientUserId: seed.providerId,
      clientUserId: seed.clientId,
      providerUserId: seed.providerId,
      serviceOfferingId: seed.offeringId,
      engagementLabel: seed.engagement?.label,
      title: seed.title,
      status: seed.status,
      terms,
      proposal: seed.proposal
        ? {
            terms: {
              ...terms,
              money: seed.proposal.money ?? terms.money,
              deadline: seed.proposal.deadline ?? terms.deadline,
            },
            byUserId: seed.providerId,
            comment: seed.proposal.comment,
          }
        : undefined,
      rejectionComment: seed.rejectionComment,
      createdDaysAgo: seed.createdDaysAgo,
      updatedDaysAgo: seed.updatedDaysAgo,
    });
  }

  return { requests: seeds.length, engagements };
}

/** Direct requests — someone is hired without a listing or a service page. */
async function seedDirectRequests(
  prisma: PrismaClient,
  talentId: string,
  businessId: string,
) {
  type DirectRequestSeed = {
    label: string;
    clientId: string;
    providerId: string;
    title: string;
    scope: string;
    money: Money | null;
    deadline: Deadline;
    message: string;
    status: WorkRequestStatus;
    proposal?: { money?: Money; deadline?: Deadline; comment: string };
    rejectionComment?: string;
    engagement?: {
      label: string;
      status: WorkEngagementStatus;
      events: EngagementEventSeed[];
    };
    createdDaysAgo: number;
    updatedDaysAgo: number;
  };

  const seeds: DirectRequestSeed[] = [
    {
      label: 'direct-ramadan-pending',
      clientId: businessId,
      providerId: talentId,
      title: 'Ramadan key visual',
      scope: 'One hero key visual plus two social adaptations.',
      money: sar(2500),
      deadline: duration(1, 'weeks'),
      message: 'Saw your Ramadan campaign work — are you free next week?',
      status: WorkRequestStatus.pending,
      createdDaysAgo: 1,
      updatedDaysAgo: 1,
    },
    {
      label: 'direct-photography-changes',
      clientId: talentId,
      providerId: businessId,
      title: 'Studio photography day',
      scope: 'Half-day product shoot with two lighting setups.',
      money: sar(3000),
      deadline: exactDate(isoDaysFromNow(14)),
      message: 'Need studio support for a client packaging launch.',
      status: WorkRequestStatus.changes_requested,
      proposal: {
        money: sar(4200),
        deadline: exactDate(isoDaysFromNow(21)),
        comment:
          'A full day with retouching is 4,200 — earliest slot is in 3 weeks.',
      },
      createdDaysAgo: 8,
      updatedDaysAgo: 6,
    },
    {
      label: 'direct-rush-rejected',
      clientId: businessId,
      providerId: talentId,
      title: 'Weekend rush edits',
      scope: 'Twelve social edits delivered over the weekend.',
      money: sar(900),
      deadline: duration(2, 'days'),
      message: 'Small rush job — can you take it this weekend?',
      status: WorkRequestStatus.rejected,
      rejectionComment: 'I am fully booked this weekend, sorry!',
      createdDaysAgo: 14,
      updatedDaysAgo: 13,
    },
    {
      label: 'direct-deck-awaiting-payment',
      clientId: businessId,
      providerId: talentId,
      title: 'Investor deck refresh',
      scope: 'Restyle 18 slides and build a reusable template.',
      money: sar(5500),
      deadline: dateRange(isoDaysFromNow(2), isoDaysFromNow(12)),
      message: 'Following our call — sending the brief over.',
      status: WorkRequestStatus.pending_payment,
      engagement: {
        label: 'eng-direct-deck',
        status: WorkEngagementStatus.pending_payment,
        events: [
          {
            to: WorkEngagementStatus.pending_payment,
            note: 'Request accepted — pending payment',
            daysAgo: 2,
          },
        ],
      },
      createdDaysAgo: 4,
      updatedDaysAgo: 2,
    },
    {
      label: 'direct-menu-active',
      clientId: businessId,
      providerId: talentId,
      title: 'Menu illustration set',
      scope: 'Twelve spot illustrations for a seasonal menu.',
      money: sar(6800),
      deadline: duration(3, 'weeks'),
      message: 'Coastal Kitchen wants illustrations in your style.',
      status: WorkRequestStatus.pending_payment,
      engagement: {
        label: 'eng-direct-menu',
        status: WorkEngagementStatus.in_progress,
        events: [
          {
            to: WorkEngagementStatus.pending_payment,
            note: 'Request accepted — pending payment',
            daysAgo: 26,
          },
          {
            from: WorkEngagementStatus.pending_payment,
            to: WorkEngagementStatus.in_progress,
            note: 'Payment settled — work started',
            daysAgo: 25,
          },
        ],
      },
      createdDaysAgo: 28,
      updatedDaysAgo: 25,
    },
    {
      label: 'direct-souk-completed',
      clientId: businessId,
      providerId: talentId,
      title: 'Souk campaign stills',
      scope: 'Retouch and adapt eight campaign stills for OOH.',
      money: sar(4000),
      deadline: flexible,
      message: 'Repeat work from the Souk Collective rebrand.',
      status: WorkRequestStatus.pending_payment,
      engagement: {
        label: 'eng-direct-souk',
        status: WorkEngagementStatus.completed,
        events: [
          {
            to: WorkEngagementStatus.pending_payment,
            note: 'Request accepted — pending payment',
            daysAgo: 70,
          },
          {
            from: WorkEngagementStatus.pending_payment,
            to: WorkEngagementStatus.in_progress,
            note: 'Payment settled — work started',
            daysAgo: 69,
          },
          {
            from: WorkEngagementStatus.in_progress,
            to: WorkEngagementStatus.delivered,
            note: 'Adapted stills delivered',
            daysAgo: 60,
            actor: 'provider',
          },
          {
            from: WorkEngagementStatus.delivered,
            to: WorkEngagementStatus.completed,
            note: 'Client accepted delivery',
            daysAgo: 58,
            actor: 'client',
          },
        ],
      },
      createdDaysAgo: 72,
      updatedDaysAgo: 58,
    },
  ];

  let engagements = 0;
  for (const seed of seeds) {
    const terms: Terms = {
      title: seed.title,
      scope: seed.scope,
      money: seed.money,
      deadline: seed.deadline,
      notes: seed.message,
    };

    if (seed.engagement) {
      engagements += 1;
      await createEngagement(prisma, {
        label: seed.engagement.label,
        source: WorkEngagementSource.direct,
        clientId: seed.clientId,
        providerId: seed.providerId,
        title: seed.title,
        status: seed.engagement.status,
        coverLetter: seed.message,
        packagePrice: seed.money?.amount ?? 0,
        deadlineLabel: deadlineLabel(seed.deadline),
        events: seed.engagement.events,
      });
    }

    await createWorkRequest(prisma, {
      label: `wr-${seed.label}`,
      source: WorkRequestSource.direct_request,
      senderUserId: seed.clientId,
      recipientUserId: seed.providerId,
      clientUserId: seed.clientId,
      providerUserId: seed.providerId,
      engagementLabel: seed.engagement?.label,
      title: seed.title,
      status: seed.status,
      terms,
      proposal: seed.proposal
        ? {
            terms: {
              ...terms,
              money: seed.proposal.money ?? terms.money,
              deadline: seed.proposal.deadline ?? terms.deadline,
            },
            byUserId: seed.providerId,
            comment: seed.proposal.comment,
          }
        : undefined,
      rejectionComment: seed.rejectionComment,
      createdDaysAgo: seed.createdDaysAgo,
      updatedDaysAgo: seed.updatedDaysAgo,
    });
  }

  return { requests: seeds.length, engagements };
}

/** Listing salary labels are free text, so the seed reads the first number. */
function priceToNumber(price: string): number {
  const match = price.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

async function createWorkRequest(
  prisma: PrismaClient,
  opts: {
    label: string;
    source: WorkRequestSource;
    senderUserId: string;
    recipientUserId: string;
    clientUserId: string;
    providerUserId: string;
    jobListingId?: string;
    jobApplicationId?: string;
    serviceOfferingId?: string;
    engagementLabel?: string;
    title: string;
    status: WorkRequestStatus;
    terms: Terms;
    proposal?: { terms: Terms; byUserId: string; comment: string };
    rejectionComment?: string;
    createdDaysAgo: number;
    updatedDaysAgo: number;
  },
) {
  const accepted = opts.status === WorkRequestStatus.pending_payment;
  const events: Array<{
    type: WorkRequestEventType;
    actorId: string;
    fromStatus: WorkRequestStatus | null;
    toStatus: WorkRequestStatus;
    note: string;
    daysAgo: number;
  }> = [
    {
      type: WorkRequestEventType.created,
      actorId: opts.senderUserId,
      fromStatus: null,
      toStatus: WorkRequestStatus.pending,
      note: 'Request sent',
      daysAgo: opts.createdDaysAgo,
    },
  ];

  if (opts.proposal) {
    events.push({
      type: WorkRequestEventType.changes_requested,
      actorId: opts.proposal.byUserId,
      fromStatus: WorkRequestStatus.pending,
      toStatus: WorkRequestStatus.changes_requested,
      note: opts.proposal.comment,
      daysAgo: opts.updatedDaysAgo,
    });
  }
  if (opts.status === WorkRequestStatus.rejected) {
    events.push({
      type: WorkRequestEventType.rejected,
      actorId: opts.recipientUserId,
      fromStatus: WorkRequestStatus.pending,
      toStatus: WorkRequestStatus.rejected,
      note: opts.rejectionComment ?? '',
      daysAgo: opts.updatedDaysAgo,
    });
  }
  if (accepted) {
    events.push({
      type: WorkRequestEventType.accepted,
      actorId: opts.recipientUserId,
      fromStatus: WorkRequestStatus.pending,
      toStatus: WorkRequestStatus.pending_payment,
      note: 'Request accepted — pending payment',
      daysAgo: opts.updatedDaysAgo,
    });
  }

  await prisma.workRequest.create({
    data: {
      id: seedId(`workRequest:${opts.label}`),
      source: opts.source,
      senderUserId: opts.senderUserId,
      recipientUserId: opts.recipientUserId,
      clientUserId: opts.clientUserId,
      providerUserId: opts.providerUserId,
      jobListingId: opts.jobListingId ?? null,
      jobApplicationId: opts.jobApplicationId ?? null,
      serviceOfferingId: opts.serviceOfferingId ?? null,
      workEngagementId: opts.engagementLabel
        ? seedId(`engagement:${opts.engagementLabel}`)
        : null,
      title: opts.title,
      status: opts.status,
      termsJson: opts.terms as unknown as Prisma.InputJsonValue,
      proposedTermsJson: opts.proposal
        ? (opts.proposal.terms as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      agreedTermsJson: accepted
        ? ((opts.proposal?.terms ??
            opts.terms) as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      proposedByUserId: opts.proposal?.byUserId ?? null,
      proposalComment: opts.proposal?.comment ?? '',
      rejectionComment: opts.rejectionComment ?? '',
      // The sender has seen their own request; unresolved requests stay unread
      // for the recipient so the inbox badge has something to show.
      senderLastViewedAt: daysAgo(opts.createdDaysAgo),
      recipientLastViewedAt:
        opts.status === WorkRequestStatus.pending
          ? null
          : daysAgo(opts.updatedDaysAgo),
      createdAt: daysAgo(opts.createdDaysAgo),
      updatedAt: daysAgo(opts.updatedDaysAgo),
      events: {
        create: events.map((event, index) => ({
          id: seedId(`workRequestEvent:${opts.label}:${index}`),
          type: event.type,
          actorId: event.actorId,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          note: event.note,
          createdAt: daysAgo(event.daysAgo),
        })),
      },
    },
  });
}

type EngagementEventSeed = {
  from?: WorkEngagementStatus;
  to: WorkEngagementStatus;
  note: string;
  daysAgo: number;
  actor?: 'client' | 'provider';
};

async function createEngagement(
  prisma: PrismaClient,
  opts: {
    label: string;
    listingLabel?: string;
    applicationLabel?: string;
    applicationId?: string;
    serviceOfferingId?: string;
    source: WorkEngagementSource;
    clientId: string;
    providerId: string;
    title: string;
    status: WorkEngagementStatus;
    coverLetter: string;
    locationCity?: string;
    packageName?: string;
    packagePrice?: number;
    deadlineLabel?: string;
    events: EngagementEventSeed[];
  },
) {
  const engagementId = seedId(`engagement:${opts.label}`);
  const applicationId =
    opts.applicationId ??
    (opts.applicationLabel
      ? seedId(`application:${opts.applicationLabel}`)
      : null);
  const listingId = opts.listingLabel
    ? seedId(`listing:${opts.listingLabel}`)
    : null;

  await prisma.workEngagement.create({
    data: {
      id: engagementId,
      listingId,
      applicationId,
      serviceOfferingId: opts.serviceOfferingId ?? null,
      clientId: opts.clientId,
      providerId: opts.providerId,
      title: opts.title,
      status: opts.status,
      source: opts.source,
      detail: {
        create: {
          serviceName: opts.title,
          packageName: opts.packageName ?? 'Project',
          packagePrice: opts.packagePrice ?? 0,
          currency: 'SAR',
          addons: [],
          deadlineLabel: opts.deadlineLabel ?? 'Flexible',
          locationCity: opts.locationCity ?? null,
          notes: '',
          coverLetter: opts.coverLetter,
        },
      },
      events: {
        create: opts.events.map((e, index) => ({
          id: seedId(`event:${opts.label}:${index}`),
          fromStatus: e.from ?? null,
          toStatus: e.to,
          actorId:
            e.actor === 'provider'
              ? opts.providerId
              : e.actor === 'client'
                ? opts.clientId
                : opts.clientId,
          note: e.note,
          createdAt: daysAgo(e.daysAgo),
        })),
      },
    },
  });
}
