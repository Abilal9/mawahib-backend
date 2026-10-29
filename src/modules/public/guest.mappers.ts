import { PackageTier } from '@prisma/client';
import { formatMoneyDisplay } from '../../common/location/geo';
import {
  EMPTY_AGGREGATE,
  EMPTY_REVIEW_SUMMARY,
  type ReviewAggregate,
  type ReviewSummaryPair,
} from '../reviews/review-summary';
import type {
  GuestAbout,
  GuestActorCard,
  GuestExploreService,
  GuestExploreTalent,
  GuestJob,
  GuestPortfolio,
  GuestPost,
  GuestProfile,
  GuestReview,
  GuestService,
} from './dto/guest.dto';

const TIER_LABEL: Record<PackageTier, 'Basic' | 'Standard' | 'Premium'> = {
  basic: 'Basic',
  standard: 'Standard',
  premium: 'Premium',
};

const CERT_STRIP = new Set([
  'credentialUrl',
  'credentialId',
  'url',
  'documentId',
]);

type ActorSource = {
  id: string;
  displayName: string;
  username: string;
  accountType: string;
  profile?: {
    avatarUrl?: string | null;
    title?: string | null;
  } | null;
};

export function toGuestActor(user: ActorSource): GuestActorCard {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    avatarUrl: user.profile?.avatarUrl ?? null,
    title: user.profile?.title ?? null,
    accountType: user.accountType,
  };
}

export function toGuestAbout(raw: unknown): GuestAbout | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  return {
    languages: Array.isArray(value.languages) ? value.languages : [],
    education: Array.isArray(value.education) ? value.education : [],
    experience: Array.isArray(value.experience) ? value.experience : [],
    certifications: Array.isArray(value.certifications)
      ? value.certifications.map(sanitizeCertification)
      : [],
  };
}

function sanitizeCertification(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const next: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
    if (CERT_STRIP.has(key)) continue;
    next[key] = val;
  }
  return next;
}

export function toGuestProfile(
  user: ActorSource & {
    postsCount: number;
    skills: Array<{ skill: string }>;
    profile?: {
      avatarUrl?: string | null;
      coverUrl?: string | null;
      title?: string | null;
      bio?: string | null;
      locationCity?: string | null;
      locationCountry?: string | null;
      aboutJson?: unknown;
    } | null;
  },
  reviewSummary: ReviewSummaryPair = EMPTY_REVIEW_SUMMARY,
): GuestProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    accountType: user.accountType,
    avatarUrl: user.profile?.avatarUrl ?? null,
    coverUrl: user.profile?.coverUrl ?? null,
    title: user.profile?.title ?? null,
    bio: user.profile?.bio ?? '',
    skills: user.skills.map((row) => row.skill),
    reviewSummary,
    postsCount: user.postsCount,
    locationCity: user.profile?.locationCity ?? null,
    locationCountry: user.profile?.locationCountry ?? null,
    about: toGuestAbout(user.profile?.aboutJson),
  };
}

export function toGuestExploreTalent(
  user: Parameters<typeof toGuestProfile>[0],
  reviewSummary: ReviewSummaryPair = EMPTY_REVIEW_SUMMARY,
): GuestExploreTalent {
  const profile = toGuestProfile(user, reviewSummary);
  return {
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
    accountType: profile.accountType,
    avatarUrl: profile.avatarUrl,
    coverUrl: profile.coverUrl,
    title: profile.title,
    bio: profile.bio,
    skills: profile.skills,
    locationCity: profile.locationCity,
    locationCountry: profile.locationCountry,
    reviewSummary: profile.reviewSummary,
  };
}

export function toGuestPost(input: {
  id: string;
  text: string;
  createdAt: Date;
  author: ActorSource;
  media: Array<{ url: string; position: number }>;
  likeCount: number;
  commentCount: number;
}): GuestPost {
  return {
    id: input.id,
    author: toGuestActor(input.author),
    text: input.text,
    media: input.media,
    createdAt: input.createdAt.toISOString(),
    likeCount: input.likeCount,
    commentCount: input.commentCount,
  };
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function toGuestJob(listing: {
  id: string;
  title: string;
  description: string;
  companyName: string | null;
  employmentType: string;
  location: string;
  currency: string;
  pricingType: string;
  fixedAmount: unknown;
  minAmount: unknown;
  maxAmount: unknown;
  salaryLabel: string | null;
  categoryId: string | null;
  customCategory: string | null;
  skills: string[];
  createdAt: Date;
  postedAt: Date | null;
  taxonomyCategory?: { nameEn: string } | null;
  taxonomySkills?: Array<{
    position: number;
    skill: { id: string; nameEn: string };
  }>;
  poster: ActorSource;
}): GuestJob {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    companyName: listing.companyName,
    employmentType: listing.employmentType,
    location: listing.location,
    currency: listing.currency,
    pricingType: listing.pricingType,
    fixedAmount: decimalToNumber(listing.fixedAmount),
    minAmount: decimalToNumber(listing.minAmount),
    maxAmount: decimalToNumber(listing.maxAmount),
    salaryLabel: listing.salaryLabel,
    categoryId: listing.categoryId,
    categoryName: listing.taxonomyCategory?.nameEn ?? null,
    customCategory: listing.customCategory,
    skills: listing.skills,
    taxonomySkills: [...(listing.taxonomySkills ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((row) => ({ id: row.skill.id, name: row.skill.nameEn })),
    poster: toGuestActor({
      ...listing.poster,
      profile: listing.poster.profile
        ? {
            avatarUrl: listing.poster.profile.avatarUrl,
            title: listing.poster.profile.title ?? null,
          }
        : null,
    }),
    createdAt: listing.createdAt.toISOString(),
    postedAt: listing.postedAt?.toISOString() ?? null,
  };
}

export function toGuestService(input: {
  offering: {
    id: string;
    title: string;
    description: string;
    category: string | null;
    categoryId: string | null;
    customCategory: string | null;
    currency: string;
    packages: Array<{
      tier: PackageTier;
      price: unknown;
      currency: string;
      deliveryLabel: string;
      includes: unknown;
    }>;
    addons: Array<{
      id: string;
      title: string;
      price: unknown;
      currency: string;
    }>;
    taxonomyCategory?: { nameEn: string } | null;
    taxonomySkills?: Array<{
      position: number;
      skill: { id: string; nameEn: string };
    }>;
  };
  images: string[];
  provider: ActorSource;
  reviewSummary?: ReviewAggregate;
}): GuestService {
  const { offering } = input;
  return {
    id: offering.id,
    title: offering.title,
    description: offering.description,
    category: offering.category,
    categoryId: offering.categoryId,
    categoryName: offering.taxonomyCategory?.nameEn ?? null,
    customCategory: offering.customCategory,
    taxonomySkills: [...(offering.taxonomySkills ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((row) => ({ id: row.skill.id, name: row.skill.nameEn })),
    currency: offering.currency,
    reviewSummary: input.reviewSummary ?? EMPTY_AGGREGATE,
    images: input.images,
    packages: offering.packages.map((pkg) => {
      const price = Number(pkg.price);
      return {
        name: TIER_LABEL[pkg.tier],
        priceLabel: formatMoneyDisplay({ amount: price, currency: pkg.currency }),
        delivery: pkg.deliveryLabel,
        includes: Array.isArray(pkg.includes) ? (pkg.includes as string[]) : [],
        price,
        currency: pkg.currency,
      };
    }),
    addons: offering.addons.map((addon) => {
      const price = Number(addon.price);
      return {
        id: addon.id,
        title: addon.title,
        priceLabel: `+ ${formatMoneyDisplay({ amount: price, currency: addon.currency })}`,
        price,
        currency: addon.currency,
      };
    }),
    provider: toGuestActor(input.provider),
  };
}

export function toGuestExploreService(input: {
  id: string;
  title: string;
  description: string;
  category: string | null;
  images: string[];
  reviewSummary?: ReviewAggregate;
  provider: ActorSource;
}): GuestExploreService {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    category: input.category,
    images: input.images,
    reviewSummary: input.reviewSummary ?? EMPTY_AGGREGATE,
    provider: toGuestActor(input.provider),
  };
}

export function toGuestPortfolio(input: {
  id: string;
  title: string;
  description: string;
  images: string[];
}): GuestPortfolio {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    images: input.images,
  };
}

export function toGuestReview(input: {
  id: string;
  rating: number;
  body: string;
  createdAt: Date;
  reviewer: ActorSource;
  media: Array<{ url: string; mimeType: string }>;
}): GuestReview {
  return {
    id: input.id,
    rating: input.rating,
    text: input.body,
    createdAt: input.createdAt.toISOString(),
    reviewer: toGuestActor(input.reviewer),
    media: input.media,
  };
}
