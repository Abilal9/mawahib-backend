import { Prisma } from '@prisma/client';

export const EXPLORE_REPOSITORY = Symbol('EXPLORE_REPOSITORY');

export const EXPLORE_BUSINESS_MATCH_LIMIT = 10;

export type ExploreTalentSort = 'recommended' | 'top-rated';

export interface ExploreTalentFilter {
  viewerId: string;
  q?: string;
  locationCode?: string;
  sort: ExploreTalentSort;
  categoryIds?: string[];
  searchSkillIds?: string[];
  skip: number;
  take: number;
}

export interface ExploreServiceFilter {
  q?: string;
  locationCode?: string;
  categoryIds?: string[];
  searchSkillIds?: string[];
  skip: number;
  take: number;
}

export type ExploreUserRecord = Prisma.UserGetPayload<{
  include: { profile: true; skills: true };
}>;

export type ExploreServiceRecord = Prisma.ServiceOfferingGetPayload<{
  include: {
    packages: true;
    media: { include: { mediaAsset: true }; orderBy: { position: 'asc' } };
    user: { include: { profile: true; skills: true } };
  };
}>;

export interface ExploreRepository {
  searchTalents(
    filter: ExploreTalentFilter,
  ): Promise<{ ids: string[]; total: number }>;
  searchBusinesses(filter: ExploreTalentFilter): Promise<ExploreUserRecord[]>;
  loadUsers(ids: string[]): Promise<ExploreUserRecord[]>;
  searchServices(
    filter: ExploreServiceFilter,
  ): Promise<{ ids: string[]; total: number }>;
  loadServices(ids: string[]): Promise<ExploreServiceRecord[]>;
}
