import {
  AccountType,
  MediaPurpose,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { OBJECT_PREFIX, uploadReadyAsset } from './media';

export type SeedUserSpec = {
  key: 'talent' | 'business';
  email: string;
  password: string;
  accountType: AccountType;
  firstName: string;
  lastName: string;
  displayName: string;
  username: string;
  phoneE164: string;
  city: string;
  country: string;
  title: string;
  bio: string;
  skills: string[];
  avatarSourceUrl: string;
  coverSourceUrl: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  ratingAvg: number;
  ratingCount: number;
  about: Prisma.InputJsonValue;
};

export function seedUserSpecs(password: string): SeedUserSpec[] {
  return [
    {
      key: 'talent',
      email: 'layla.talent@mawahib.dev',
      password,
      accountType: AccountType.talent,
      firstName: 'Layla',
      lastName: 'AlHarbi',
      displayName: 'Layla AlHarbi',
      username: 'layla_talent_dev',
      phoneE164: '+966560900601',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      title: 'Brand & Product Designer',
      bio: 'Riyadh-based designer crafting brand systems, product UI, and campaign visuals for Gulf startups. Focused on clear storytelling, bilingual layouts, and shippable Figma files.',
      skills: [
        'Branding',
        'UI Design',
        'Figma',
        'Illustration',
        'Motion',
        'Design Systems',
      ],
      avatarSourceUrl:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
      coverSourceUrl:
        'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1200&h=600&fit=crop',
      followersCount: 1840,
      followingCount: 312,
      postsCount: 27,
      ratingAvg: 4.9,
      ratingCount: 38,
      about: {
        languages: [
          { id: 'l1', name: 'Arabic', level: 'Native', flag: '🇸🇦' },
          { id: 'l2', name: 'English', level: 'C1 Advanced', flag: '🇬🇧' },
        ],
        education: [
          {
            id: 'ed1',
            school: 'Princess Nourah University',
            degree: 'B.A. Visual Communication',
            field: 'Design',
            years: '2017 – 2021',
            gpa: '3.7/4.0',
            description:
              'Thesis on bilingual brand systems for Saudi hospitality.',
            logoColor: '#0EA5E9',
          },
        ],
        experience: [
          {
            id: 'ex1',
            title: 'Senior Brand Designer',
            company: 'Sand & Pixel Studio',
            type: 'Full-time',
            years: '2022 – Present',
            description:
              'Lead identity and digital product design for fintech and retail clients across KSA and UAE.',
            logoColor: '#F59E0B',
          },
          {
            id: 'ex2',
            title: 'Product Designer',
            company: 'Horizon Labs',
            type: 'Full-time',
            years: '2020 – 2022',
            description:
              'Shipped mobile onboarding and dashboard UI for an SME payments product.',
            logoColor: '#6366F1',
          },
        ],
        certifications: [
          {
            id: 'c1',
            name: 'Google UX Design Certificate',
            org: 'Coursera',
            year: '2021',
          },
          {
            id: 'c2',
            name: 'Figma Professional',
            org: 'Figma',
            year: '2023',
          },
        ],
      },
    },
    {
      key: 'business',
      email: 'najd.studio@mawahib.dev',
      password,
      accountType: AccountType.business,
      firstName: 'Najd',
      lastName: 'Studio',
      displayName: 'Najd Creative Studio',
      username: 'najd_studio_dev',
      phoneE164: '+966560900602',
      city: 'Jeddah',
      country: 'Saudi Arabia',
      title: 'Creative Production Studio',
      bio: 'Jeddah studio specializing in brand launches, campaign art direction, and content systems for hospitality, retail, and tech. We hire independent talent for overflow and specialty work.',
      skills: [
        'Campaign Design',
        'Art Direction',
        'Content Strategy',
        'Social',
        'Brand Systems',
      ],
      avatarSourceUrl:
        'https://images.unsplash.com/photo-1560179707-f14ee9aa457c?w=400&h=400&fit=crop',
      coverSourceUrl:
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=600&fit=crop',
      followersCount: 4260,
      followingCount: 188,
      postsCount: 64,
      ratingAvg: 4.8,
      ratingCount: 52,
      about: {
        languages: [
          { id: 'l1', name: 'Arabic', level: 'Native', flag: '🇸🇦' },
          { id: 'l2', name: 'English', level: 'Business fluent', flag: '🇬🇧' },
        ],
        education: [
          {
            id: 'ed1',
            school: 'Effat University',
            degree: 'B.A. Design',
            field: 'Visual Communication',
            years: 'Founding team background',
            description: 'Studio founded by Effat and KAUST alumni designers.',
            logoColor: '#14B8A6',
          },
        ],
        experience: [
          {
            id: 'ex1',
            title: 'Creative Studio',
            company: 'Najd Creative Studio',
            type: 'Studio',
            years: '2019 – Present',
            description:
              'Delivered 120+ campaigns for hospitality, F&B, and consumer brands in the Kingdom.',
            logoColor: '#F43F5E',
          },
        ],
        certifications: [
          {
            id: 'c1',
            name: 'Meta Blueprint Marketing',
            org: 'Meta',
            year: '2022',
          },
        ],
      },
    },
  ];
}

export async function upsertDomainUser(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  spec: SeedUserSpec,
) {
  const avatar = await uploadReadyAsset(
    supabase,
    prisma,
    userId,
    'avatars',
    MediaPurpose.avatar,
    'avatar',
    spec.avatarSourceUrl,
  );
  const cover = await uploadReadyAsset(
    supabase,
    prisma,
    userId,
    'avatars',
    MediaPurpose.avatar,
    'cover',
    spec.coverSourceUrl,
  );

  const avatarUrl = avatar.publicUrl ?? spec.avatarSourceUrl;
  const coverUrl = cover.publicUrl ?? spec.coverSourceUrl;

  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: spec.email,
      accountType: spec.accountType,
      displayName: spec.displayName,
      username: spec.username,
      isVerified: true,
      followersCount: spec.followersCount,
      followingCount: spec.followingCount,
      postsCount: spec.postsCount,
      ratingAvg: spec.ratingAvg,
      ratingCount: spec.ratingCount,
      profile: {
        create: {
          bio: spec.bio,
          title: spec.title,
          locationCity: spec.city,
          locationCountry: spec.country,
          avatarUrl,
          coverUrl,
          phoneE164: spec.phoneE164,
          phoneVerified: false,
          emailVerified: true,
          aboutJson: spec.about,
        },
      },
      skills: {
        create: spec.skills.map((skill) => ({ skill })),
      },
    },
    update: {
      email: spec.email,
      accountType: spec.accountType,
      displayName: spec.displayName,
      username: spec.username,
      isVerified: true,
      followersCount: spec.followersCount,
      followingCount: spec.followingCount,
      postsCount: spec.postsCount,
      ratingAvg: spec.ratingAvg,
      ratingCount: spec.ratingCount,
      profile: {
        upsert: {
          create: {
            bio: spec.bio,
            title: spec.title,
            locationCity: spec.city,
            locationCountry: spec.country,
            avatarUrl,
            coverUrl,
            phoneE164: spec.phoneE164,
            phoneVerified: false,
            emailVerified: true,
            aboutJson: spec.about,
          },
          update: {
            bio: spec.bio,
            title: spec.title,
            locationCity: spec.city,
            locationCountry: spec.country,
            avatarUrl,
            coverUrl,
            phoneE164: spec.phoneE164,
            emailVerified: true,
            aboutJson: spec.about,
          },
        },
      },
    },
  });

  await prisma.userSkill.deleteMany({ where: { userId } });
  await prisma.userSkill.createMany({
    data: spec.skills.map((skill) => ({ userId, skill })),
  });
}

export async function clearSeedOwnedContent(
  prisma: PrismaClient,
  userId: string,
) {
  const projects = await prisma.portfolioProject.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const p of projects) {
    await prisma.portfolioMedia.deleteMany({ where: { projectId: p.id } });
    await prisma.portfolioProject.delete({ where: { id: p.id } });
  }

  const offerings = await prisma.serviceOffering.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const o of offerings) {
    await prisma.serviceMedia.deleteMany({ where: { offeringId: o.id } });
    await prisma.servicePackage.deleteMany({ where: { offeringId: o.id } });
    await prisma.serviceAddon.deleteMany({ where: { offeringId: o.id } });
    await prisma.serviceOffering.delete({ where: { id: o.id } });
  }

  await prisma.mediaAsset.deleteMany({
    where: {
      ownerId: userId,
      objectKey: { startsWith: `${OBJECT_PREFIX}/` },
    },
  });
}
