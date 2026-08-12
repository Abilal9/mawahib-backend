import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  PrismaClient,
  WorkEngagementSource,
  WorkEngagementStatus,
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

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export async function clearMarketplaceForUsers(
  prisma: PrismaClient,
  talentId: string,
  businessId: string,
) {
  await prisma.workEngagement.deleteMany({
    where: {
      OR: [
        { clientId: talentId },
        { providerId: talentId },
        { clientId: businessId },
        { providerId: businessId },
      ],
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

  type AppSeed = {
    label: string;
    listing: string;
    status: JobApplicationStatus;
    coverLetter: string;
    daysAgo: number;
  };

  const applications: AppSeed[] = [
    {
      label: 'app-brand-submitted',
      listing: 'brand-designer',
      status: JobApplicationStatus.submitted,
      coverLetter:
        'I recently shipped a hospitality identity with bilingual guidelines and would love to support your Red Sea launch.',
      daysAgo: 1,
    },
    {
      label: 'app-ui-review',
      listing: 'product-ui',
      status: JobApplicationStatus.under_review,
      coverLetter:
        'Attached portfolio includes a full fintech savings flow with design tokens and prototype.',
      daysAgo: 3,
    },
    {
      label: 'app-social-rejected',
      listing: 'social-lead',
      status: JobApplicationStatus.rejected,
      coverLetter:
        'I can lead the Ramadan calendar and deliver bilingual social systems end-to-end.',
      daysAgo: 4,
    },
    {
      label: 'app-motion-submitted',
      listing: 'motion-gig',
      status: JobApplicationStatus.submitted,
      coverLetter:
        'Happy to deliver a 15s teaser with AE source. Recent launch work in my portfolio.',
      daysAgo: 0,
    },
    {
      label: 'app-coffee-accepted',
      listing: 'in-progress-brand',
      status: JobApplicationStatus.accepted,
      coverLetter:
        'I can own the coffee identity system — packaging, guidelines, and launch assets.',
      daysAgo: 16,
    },
    {
      label: 'app-savings-accepted',
      listing: 'completed-ui',
      status: JobApplicationStatus.accepted,
      coverLetter:
        'Ready to deliver a polished savings UI kit with handoff-ready components.',
      daysAgo: 55,
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

  // Active engagement from coffee brand hire
  await createEngagement(prisma, {
    label: 'eng-coffee-active',
    listingLabel: 'in-progress-brand',
    applicationLabel: 'app-coffee-accepted',
    clientId: businessId,
    providerId: talentId,
    title: 'Identity System for Specialty Coffee',
    status: WorkEngagementStatus.in_progress,
    coverLetter: applications.find((a) => a.label === 'app-coffee-accepted')!
      .coverLetter,
    locationCity: 'Riyadh',
    events: [
      {
        to: WorkEngagementStatus.in_progress,
        note: 'Engagement created from accepted application',
        daysAgo: 15,
      },
    ],
  });

  // Delivered engagement
  await createEngagement(prisma, {
    label: 'eng-savings-delivered',
    listingLabel: 'completed-ui',
    applicationLabel: 'app-savings-accepted',
    clientId: businessId,
    providerId: talentId,
    title: 'Savings App UI Kit',
    status: WorkEngagementStatus.delivered,
    coverLetter: applications.find((a) => a.label === 'app-savings-accepted')!
      .coverLetter,
    locationCity: 'Remote',
    packagePrice: 12000,
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

  // Completed engagement (second path — use closed-web listing without unique app conflict)
  // Create a dedicated accepted application + completed engagement on closed-web
  const completedAppId = seedId('application:app-web-completed');
  await prisma.jobApplication.create({
    data: {
      id: completedAppId,
      listingId: listingIds['closed-web']!,
      applicantId: talentId,
      coverLetter: 'Delivered a full visual refresh with component library.',
      status: JobApplicationStatus.accepted,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(20),
    },
  });

  await createEngagement(prisma, {
    label: 'eng-web-completed',
    listingLabel: 'closed-web',
    applicationId: completedAppId,
    clientId: businessId,
    providerId: talentId,
    title: 'Website Visual Refresh',
    status: WorkEngagementStatus.completed,
    coverLetter: 'Delivered a full visual refresh with component library.',
    locationCity: 'Riyadh',
    packagePrice: 15000,
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

  // Fix completed-ui listing status — engagement delivered, listing already completed
  // Fix savings engagement: listing was completed; keep listing completed

  return {
    listings: LISTINGS.length,
    applications: applications.length + 1,
    engagements: 3,
  };
}

async function createEngagement(
  prisma: PrismaClient,
  opts: {
    label: string;
    listingLabel: string;
    applicationLabel?: string;
    applicationId?: string;
    clientId: string;
    providerId: string;
    title: string;
    status: WorkEngagementStatus;
    coverLetter: string;
    locationCity?: string;
    packagePrice?: number;
    events: Array<{
      from?: WorkEngagementStatus;
      to: WorkEngagementStatus;
      note: string;
      daysAgo: number;
      actor?: 'client' | 'provider';
    }>;
  },
) {
  const engagementId = seedId(`engagement:${opts.label}`);
  const applicationId =
    opts.applicationId ??
    (opts.applicationLabel
      ? seedId(`application:${opts.applicationLabel}`)
      : null);
  const listingId = seedId(`listing:${opts.listingLabel}`);

  await prisma.workEngagement.create({
    data: {
      id: engagementId,
      listingId,
      applicationId,
      clientId: opts.clientId,
      providerId: opts.providerId,
      title: opts.title,
      status: opts.status,
      source: WorkEngagementSource.listing_application,
      detail: {
        create: {
          serviceName: opts.title,
          packageName: 'Project',
          packagePrice: opts.packagePrice ?? 0,
          currency: 'SAR',
          addons: [],
          deadlineLabel: 'Flexible',
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
