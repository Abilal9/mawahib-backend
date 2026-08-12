import { MediaAsset, MediaPurpose, MediaStatus, Prisma } from '@prisma/client';

export type { MediaAsset, MediaPurpose, MediaStatus };

export interface CreateMediaAssetInput {
  id: string;
  ownerId: string;
  bucket: string;
  objectKey: string;
  mimeType: string;
  byteSize: bigint;
  purpose: MediaPurpose;
  width?: number | null;
  height?: number | null;
}

export interface MediaAssetRepository {
  createPending(input: CreateMediaAssetInput): Promise<MediaAsset>;
  findById(id: string): Promise<MediaAsset | null>;
  findOwnedById(id: string, ownerId: string): Promise<MediaAsset | null>;
  markReady(id: string): Promise<MediaAsset>;
  markFailed(id: string): Promise<MediaAsset>;
  findReadyOwnedByIds(ownerId: string, ids: string[]): Promise<MediaAsset[]>;
}

export const MEDIA_ASSET_REPOSITORY = Symbol('MEDIA_ASSET_REPOSITORY');

export type MediaCreateData = Prisma.MediaAssetCreateInput;
