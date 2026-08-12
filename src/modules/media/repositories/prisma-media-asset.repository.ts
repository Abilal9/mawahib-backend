import { Injectable } from '@nestjs/common';
import { MediaAsset, MediaStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  CreateMediaAssetInput,
  MediaAssetRepository,
} from './media-asset.repository';

@Injectable()
export class PrismaMediaAssetRepository implements MediaAssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPending(input: CreateMediaAssetInput): Promise<MediaAsset> {
    return this.prisma.mediaAsset.create({
      data: {
        id: input.id,
        ownerId: input.ownerId,
        bucket: input.bucket,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        purpose: input.purpose,
        width: input.width ?? null,
        height: input.height ?? null,
        status: MediaStatus.pending,
      },
    });
  }

  findById(id: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findFirst({
      where: { id, deletedAt: null },
    });
  }

  findOwnedById(id: string, ownerId: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findFirst({
      where: { id, ownerId, deletedAt: null },
    });
  }

  markReady(id: string): Promise<MediaAsset> {
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { status: MediaStatus.ready },
    });
  }

  markFailed(id: string): Promise<MediaAsset> {
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { status: MediaStatus.failed },
    });
  }

  findReadyOwnedByIds(ownerId: string, ids: string[]): Promise<MediaAsset[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.mediaAsset.findMany({
      where: {
        ownerId,
        id: { in: ids },
        status: MediaStatus.ready,
        deletedAt: null,
      },
    });
  }
}
