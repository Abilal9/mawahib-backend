import {
  MediaPurpose,
  PackageTier,
  PrismaClient,
  ServiceOfferingStatus,
} from '@prisma/client';
import { seedId } from './ids';
import { uploadReadyAsset } from './media';

async function createProject(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  opts: {
    label: string;
    title: string;
    description: string;
    position: number;
    imageUrls: string[];
  },
) {
  const mediaIds: string[] = [];
  for (let i = 0; i < opts.imageUrls.length; i += 1) {
    const uploaded = await uploadReadyAsset(
      supabase,
      prisma,
      userId,
      'portfolio',
      MediaPurpose.portfolio,
      `${opts.label}-${i + 1}`,
      opts.imageUrls[i]!,
    );
    mediaIds.push(uploaded.asset.id);
  }

  await prisma.portfolioProject.create({
    data: {
      id: seedId(`portfolio:${userId}:${opts.label}`),
      userId,
      title: opts.title,
      description: opts.description,
      position: opts.position,
      media: {
        create: mediaIds.map((mediaAssetId, position) => ({
          id: seedId(`pm:${userId}:${opts.label}:${position}`),
          mediaAssetId,
          position,
        })),
      },
    },
  });
}

async function createOffering(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  opts: {
    label: string;
    title: string;
    description: string;
    category: string;
    position: number;
    imageUrl: string;
    packages: Array<{
      tier: PackageTier;
      price: number;
      deliveryLabel: string;
      includes: string[];
    }>;
    addons: Array<{ title: string; price: number }>;
    ratingAvg?: number;
    ratingCount?: number;
  },
) {
  const media = await uploadReadyAsset(
    supabase,
    prisma,
    userId,
    'services',
    MediaPurpose.service,
    opts.label,
    opts.imageUrl,
  );

  await prisma.serviceOffering.create({
    data: {
      id: seedId(`service:${userId}:${opts.label}`),
      userId,
      title: opts.title,
      description: opts.description,
      category: opts.category,
      status: ServiceOfferingStatus.published,
      currency: 'SAR',
      position: opts.position,
      ratingAvg: opts.ratingAvg ?? 4.8,
      ratingCount: opts.ratingCount ?? 12,
      packages: {
        create: opts.packages.map((p) => ({
          id: seedId(`pkg:${userId}:${opts.label}:${p.tier}`),
          tier: p.tier,
          price: p.price,
          currency: 'SAR',
          deliveryLabel: p.deliveryLabel,
          includes: p.includes,
        })),
      },
      addons: {
        create: opts.addons.map((a, position) => ({
          id: seedId(`addon:${userId}:${opts.label}:${position}`),
          title: a.title,
          price: a.price,
          currency: 'SAR',
          position,
        })),
      },
      media: {
        create: [
          {
            id: seedId(`sm:${userId}:${opts.label}`),
            mediaAssetId: media.asset.id,
            position: 0,
          },
        ],
      },
    },
  });
}

export async function seedTalentProfessional(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  await createProject(prisma, supabase, userId, {
    label: 'desert-bloom',
    title: 'Desert Bloom Brand System',
    description:
      'Full identity for a specialty coffee brand — logomark, packaging cues, and bilingual guidelines.',
    position: 0,
    imageUrls: [
      'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1572044162444-ad60f128bdea?w=800&h=600&fit=crop',
    ],
  });
  await createProject(prisma, supabase, userId, {
    label: 'fintech-ui',
    title: 'Wadi Pay Mobile UI',
    description:
      'Savings product UI kit with onboarding, goals, and transfer flows in Figma.',
    position: 1,
    imageUrls: [
      'https://images.unsplash.com/photo-1559028012-481c04fa702d?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
    ],
  });
  await createProject(prisma, supabase, userId, {
    label: 'ramadan-social',
    title: 'Ramadan Social Campaign',
    description:
      'Launch creatives and story templates for a retail Ramadan collection.',
    position: 2,
    imageUrls: [
      'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=800&h=600&fit=crop',
    ],
  });
  await createProject(prisma, supabase, userId, {
    label: 'hospitality-deck',
    title: 'Red Sea Pitch Deck',
    description:
      'Investor pitch visuals and iconography for a hospitality concept.',
    position: 3,
    imageUrls: [
      'https://images.unsplash.com/photo-1542744173-8e2bd1ad4490?w=800&h=600&fit=crop',
    ],
  });

  await createOffering(prisma, supabase, userId, {
    label: 'brand-identity',
    title: 'Logo & Brand Identity',
    description:
      'Logo concepts, color system, and brand guidelines tailored for bilingual markets.',
    category: 'Branding',
    position: 0,
    imageUrl:
      'https://images.unsplash.com/photo-1626785774573-4b7993143460?w=800&h=600&fit=crop',
    packages: [
      {
        tier: PackageTier.basic,
        price: 900,
        deliveryLabel: '5 days',
        includes: ['1 logo concept', '2 revisions', 'PNG + SVG'],
      },
      {
        tier: PackageTier.standard,
        price: 1900,
        deliveryLabel: '10 days',
        includes: ['3 concepts', 'Brand colors', 'Mini guidelines'],
      },
      {
        tier: PackageTier.premium,
        price: 3800,
        deliveryLabel: '15 days',
        includes: ['Full brand kit', 'Social templates', 'Source files'],
      },
    ],
    addons: [
      { title: 'Business card design', price: 280 },
      { title: 'Animated logo mark', price: 650 },
    ],
    ratingAvg: 4.9,
    ratingCount: 21,
  });

  await createOffering(prisma, supabase, userId, {
    label: 'mobile-ui',
    title: 'Mobile UI Design',
    description: 'App screens, interactive prototype, and developer handoff.',
    category: 'UI Design',
    position: 1,
    imageUrl:
      'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=800&h=600&fit=crop',
    packages: [
      {
        tier: PackageTier.basic,
        price: 1400,
        deliveryLabel: '7 days',
        includes: ['3 key screens', 'Figma file'],
      },
      {
        tier: PackageTier.standard,
        price: 3000,
        deliveryLabel: '14 days',
        includes: ['8 screens', 'Prototype', 'Design tokens'],
      },
      {
        tier: PackageTier.premium,
        price: 5600,
        deliveryLabel: '21 days',
        includes: ['Full flow', 'Handoff notes', '2 revision rounds'],
      },
    ],
    addons: [{ title: 'Dark mode variants', price: 750 }],
    ratingAvg: 4.8,
    ratingCount: 14,
  });

  await createOffering(prisma, supabase, userId, {
    label: 'social-pack',
    title: 'Social Content Pack',
    description: 'Monthly social creatives for Instagram and LinkedIn.',
    category: 'Social',
    position: 2,
    imageUrl:
      'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=800&h=600&fit=crop',
    packages: [
      {
        tier: PackageTier.basic,
        price: 950,
        deliveryLabel: '5 days',
        includes: ['8 posts', 'Captions draft'],
      },
      {
        tier: PackageTier.standard,
        price: 1700,
        deliveryLabel: '7 days',
        includes: ['16 posts', 'Stories set', 'Hashtag research'],
      },
      {
        tier: PackageTier.premium,
        price: 2700,
        deliveryLabel: '10 days',
        includes: ['24 posts', 'Reels covers', 'Content calendar'],
      },
    ],
    addons: [
      { title: 'Extra 4 posts', price: 320 },
      { title: 'Arabic copywriting', price: 420 },
    ],
    ratingAvg: 4.7,
    ratingCount: 19,
  });
}

export async function seedBusinessProfessional(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  await createProject(prisma, supabase, userId, {
    label: 'red-sea',
    title: 'Red Sea Resort Campaign',
    description: 'Multi-channel brand campaign for a hospitality launch.',
    position: 0,
    imageUrls: [
      'https://images.unsplash.com/photo-1542744173-8e2bd1ad4490?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&h=600&fit=crop',
    ],
  });
  await createProject(prisma, supabase, userId, {
    label: 'souk-rebrand',
    title: 'Souk Collective Rebrand',
    description: 'Retail rebrand across packaging, signage, and digital.',
    position: 1,
    imageUrls: [
      'https://images.unsplash.com/photo-1557804506-669a709abc7d?w=800&h=600&fit=crop',
    ],
  });
  await createProject(prisma, supabase, userId, {
    label: 'fintech-launch',
    title: 'Fintech Product Launch',
    description: 'Launch film stills, key visuals, and OOH adaptations.',
    position: 2,
    imageUrls: [
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&h=600&fit=crop',
    ],
  });
  await createProject(prisma, supabase, userId, {
    label: 'fnb-system',
    title: 'Coastal Kitchen Visual System',
    description: 'Menu design language and seasonal campaign templates.',
    position: 3,
    imageUrls: [
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=600&fit=crop',
    ],
  });

  await createOffering(prisma, supabase, userId, {
    label: 'campaign-retainer',
    title: 'Campaign Production Retainer',
    description: 'Monthly creative production for growing brands.',
    category: 'Campaigns',
    position: 0,
    imageUrl:
      'https://images.unsplash.com/photo-1557804506-669a709abc7d?w=800&h=600&fit=crop',
    packages: [
      {
        tier: PackageTier.basic,
        price: 5500,
        deliveryLabel: 'Monthly',
        includes: ['12 assets', '1 revision round'],
      },
      {
        tier: PackageTier.standard,
        price: 9500,
        deliveryLabel: 'Monthly',
        includes: ['24 assets', 'Art direction calls'],
      },
      {
        tier: PackageTier.premium,
        price: 16000,
        deliveryLabel: 'Monthly',
        includes: ['Full campaign', 'Motion extras', 'Priority turnaround'],
      },
    ],
    addons: [{ title: 'On-site shoot day', price: 3800 }],
    ratingAvg: 4.8,
    ratingCount: 17,
  });

  await createOffering(prisma, supabase, userId, {
    label: 'brand-launch',
    title: 'Brand Launch Kit',
    description: 'End-to-end launch creative for a product or venue opening.',
    category: 'Branding',
    position: 1,
    imageUrl:
      'https://images.unsplash.com/photo-1556761175-b413da4b248b?w=800&h=600&fit=crop',
    packages: [
      {
        tier: PackageTier.basic,
        price: 8000,
        deliveryLabel: '3 weeks',
        includes: ['Key visual', 'Social set', 'Press kit cover'],
      },
      {
        tier: PackageTier.standard,
        price: 14000,
        deliveryLabel: '4 weeks',
        includes: ['Full toolkit', 'OOH adaptations', 'Guidelines'],
      },
      {
        tier: PackageTier.premium,
        price: 22000,
        deliveryLabel: '6 weeks',
        includes: ['Campaign film frames', 'Influencer pack', 'Event signage'],
      },
    ],
    addons: [{ title: 'Arabic copy polish', price: 1200 }],
    ratingAvg: 4.9,
    ratingCount: 9,
  });

  await createOffering(prisma, supabase, userId, {
    label: 'content-sprint',
    title: 'Two-Week Content Sprint',
    description: 'Fast content production for seasonal pushes.',
    category: 'Social',
    position: 2,
    imageUrl:
      'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=800&h=600&fit=crop',
    packages: [
      {
        tier: PackageTier.basic,
        price: 4200,
        deliveryLabel: '10 days',
        includes: ['20 assets', 'Caption drafts'],
      },
      {
        tier: PackageTier.standard,
        price: 6800,
        deliveryLabel: '12 days',
        includes: ['35 assets', 'Stories + posts', 'Scheduling guide'],
      },
      {
        tier: PackageTier.premium,
        price: 9800,
        deliveryLabel: '14 days',
        includes: ['50 assets', 'Motion stills', 'Performance review'],
      },
    ],
    addons: [{ title: 'Extra platform adaptations', price: 900 }],
    ratingAvg: 4.6,
    ratingCount: 11,
  });
}
