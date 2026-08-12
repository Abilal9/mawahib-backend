import {
  MediaAsset,
  PortfolioMedia,
  PortfolioProject,
  Prisma,
} from '@prisma/client';

export type PortfolioProjectWithMedia = PortfolioProject & {
  media: Array<PortfolioMedia & { mediaAsset: MediaAsset }>;
};

export interface CreatePortfolioProjectInput {
  id: string;
  userId: string;
  title: string;
  description: string;
  position: number;
  media: Array<{ mediaAssetId: string; position: number; isVideo: boolean }>;
}

export interface UpdatePortfolioProjectInput {
  title?: string;
  description?: string;
  media?: Array<{ mediaAssetId: string; position: number; isVideo: boolean }>;
}

export interface PortfolioRepository {
  listByUser(userId: string): Promise<PortfolioProjectWithMedia[]>;
  findById(id: string): Promise<PortfolioProjectWithMedia | null>;
  create(
    input: CreatePortfolioProjectInput,
  ): Promise<PortfolioProjectWithMedia>;
  update(
    id: string,
    userId: string,
    input: UpdatePortfolioProjectInput,
  ): Promise<PortfolioProjectWithMedia>;
  softDelete(id: string, userId: string): Promise<void>;
  reorder(userId: string, projectIds: string[]): Promise<void>;
  countByUser(userId: string): Promise<number>;
}

export const PORTFOLIO_REPOSITORY = Symbol('PORTFOLIO_REPOSITORY');

export type PortfolioCreateData = Prisma.PortfolioProjectCreateInput;
