import type {
  ReviewAggregate,
  ReviewSummaryPair,
} from '../../reviews/review-summary';

export type GuestActorCard = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  title: string | null;
  accountType: string;
};

export type GuestMedia = {
  url: string;
  position: number;
};

export type GuestAbout = {
  languages: unknown[];
  education: unknown[];
  experience: unknown[];
  certifications: unknown[];
};

export type GuestProfile = {
  id: string;
  displayName: string;
  username: string;
  accountType: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  title: string | null;
  bio: string;
  skills: string[];
  reviewSummary: ReviewSummaryPair;
  postsCount: number;
  locationCity: string | null;
  locationCountry: string | null;
  about: GuestAbout | null;
};

export type GuestPost = {
  id: string;
  author: GuestActorCard;
  text: string;
  media: GuestMedia[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
};

export type GuestPostPage = {
  items: GuestPost[];
  nextCursor: string | null;
};

export type GuestJob = {
  id: string;
  title: string;
  description: string;
  companyName: string | null;
  employmentType: string;
  location: string;
  currency: string;
  pricingType: string;
  fixedAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  salaryLabel: string | null;
  categoryId: string | null;
  categoryName: string | null;
  customCategory: string | null;
  skills: string[];
  taxonomySkills: Array<{ id: string; name: string }>;
  poster: GuestActorCard;
  createdAt: string;
  postedAt: string | null;
};

export type GuestJobPage = {
  items: GuestJob[];
  take: number;
  skip: number;
};

export type GuestServicePackage = {
  name: 'Basic' | 'Standard' | 'Premium';
  priceLabel: string;
  delivery: string;
  includes: string[];
  price: number;
  currency: string;
};

export type GuestServiceAddon = {
  id: string;
  title: string;
  priceLabel: string;
  price: number;
  currency: string;
};

export type GuestService = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  categoryId: string | null;
  categoryName: string | null;
  customCategory: string | null;
  taxonomySkills: Array<{ id: string; name: string }>;
  currency: string;
  reviewSummary: ReviewAggregate;
  images: string[];
  packages: GuestServicePackage[];
  addons: GuestServiceAddon[];
  provider: GuestActorCard;
};

export type GuestPortfolio = {
  id: string;
  title: string;
  description: string;
  images: string[];
};

export type GuestReviewMedia = {
  url: string;
  mimeType: string;
};

export type GuestReview = {
  id: string;
  rating: number;
  text: string;
  createdAt: string;
  reviewer: GuestActorCard;
  media: GuestReviewMedia[];
};

export type GuestReviewPage = {
  items: GuestReview[];
  nextCursor: string | null;
};

export type GuestExploreTalent = {
  id: string;
  displayName: string;
  username: string;
  accountType: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  title: string | null;
  bio: string;
  skills: string[];
  locationCity: string | null;
  locationCountry: string | null;
  reviewSummary: ReviewSummaryPair;
};

export type GuestExploreService = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  images: string[];
  reviewSummary: ReviewAggregate;
  provider: GuestActorCard;
};

export type GuestExplorePage<T> = {
  items: T[];
  take: number;
  skip: number;
};
