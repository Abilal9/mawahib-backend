import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaPurpose, MediaStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  SupabaseService,
  type StorageBucket,
} from '../../infrastructure/supabase/supabase.service';
import { CreateUploadSessionDto } from './dto/media.dto';
import {
  MediaAssetResponseDto,
  UploadSessionResponseDto,
} from './dto/media-response.dto';
import { MEDIA_ASSET_REPOSITORY } from './repositories/media-asset.repository';
import type { MediaAssetRepository } from './repositories/media-asset.repository';

const PURPOSE_CONFIG: Record<
  MediaPurpose,
  {
    bucket: StorageBucket;
    maxBytes: number;
    mimeTypes: string[];
  }
> = {
  avatar: {
    bucket: 'avatars',
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  portfolio: {
    bucket: 'portfolio',
    maxBytes: 50 * 1024 * 1024,
    mimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
    ],
  },
  service: {
    bucket: 'services',
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  message: {
    bucket: 'messages',
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
};

@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY)
    private readonly media: MediaAssetRepository,
    private readonly supabase: SupabaseService,
  ) {}

  async createUploadSession(
    ownerId: string,
    dto: CreateUploadSessionDto,
  ): Promise<UploadSessionResponseDto> {
    const config = PURPOSE_CONFIG[dto.purpose];
    const mimeType = dto.mimeType.trim().toLowerCase();
    if (!config.mimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported mime type for ${dto.purpose}: ${mimeType}`,
      );
    }
    if (dto.byteSize > config.maxBytes) {
      throw new BadRequestException(
        `File exceeds max size of ${config.maxBytes} bytes for ${dto.purpose}`,
      );
    }

    const id = randomUUID();
    const ext = extensionForMime(mimeType, dto.fileName);
    const objectKey = `${ownerId}/${id}${ext}`;

    const asset = await this.media.createPending({
      id,
      ownerId,
      bucket: config.bucket,
      objectKey,
      mimeType,
      byteSize: BigInt(dto.byteSize),
      purpose: dto.purpose,
    });

    const signed = await this.supabase.createSignedUpload(
      config.bucket,
      objectKey,
    );

    return UploadSessionResponseDto.create({
      asset,
      uploadUrl: signed.signedUrl,
      token: signed.token,
    });
  }

  async completeUpload(
    ownerId: string,
    mediaAssetId: string,
  ): Promise<MediaAssetResponseDto> {
    const asset = await this.media.findOwnedById(mediaAssetId, ownerId);
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    if (asset.status === MediaStatus.ready) {
      const url = await this.resolveUrl(
        asset.bucket as StorageBucket,
        asset.objectKey,
      );
      return MediaAssetResponseDto.fromEntity(asset, url);
    }

    const exists = await this.supabase.objectExists(
      asset.bucket as StorageBucket,
      asset.objectKey,
    );
    if (!exists) {
      await this.media.markFailed(asset.id);
      throw new BadRequestException(
        'Uploaded object not found in storage — upload may have failed',
      );
    }

    const ready = await this.media.markReady(asset.id);
    const url = await this.resolveUrl(
      ready.bucket as StorageBucket,
      ready.objectKey,
    );
    return MediaAssetResponseDto.fromEntity(ready, url);
  }

  async requireReadyOwnedAssets(ownerId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const assets = await this.media.findReadyOwnedByIds(ownerId, unique);
    if (assets.length !== unique.length) {
      throw new BadRequestException(
        'One or more media assets are missing, not ready, or not owned by you',
      );
    }
    const byId = new Map(assets.map((a) => [a.id, a]));
    return unique.map((id) => byId.get(id)!);
  }

  /**
   * Signed read URL for any ready media asset (no ownership check).
   * Callers must authorize access (e.g. conversation participants).
   */
  async getSignedUrlForAsset(assetId: string): Promise<string | null> {
    const asset = await this.media.findById(assetId);
    if (!asset || asset.status !== MediaStatus.ready) return null;
    return this.resolveUrl(asset.bucket as StorageBucket, asset.objectKey);
  }

  async resolveUrlForAsset(asset: {
    bucket: string;
    objectKey: string;
    status: MediaStatus;
    ownerId?: string;
    requesterId?: string;
  }): Promise<string | null> {
    if (asset.status !== MediaStatus.ready) return null;
    return this.resolveUrl(asset.bucket as StorageBucket, asset.objectKey);
  }

  async getOwnedAsset(
    ownerId: string,
    mediaAssetId: string,
  ): Promise<MediaAssetResponseDto> {
    const asset = await this.media.findOwnedById(mediaAssetId, ownerId);
    if (!asset) throw new NotFoundException('Media asset not found');
    if (asset.ownerId !== ownerId) {
      throw new ForbiddenException();
    }
    const url =
      asset.status === MediaStatus.ready
        ? await this.resolveUrl(asset.bucket as StorageBucket, asset.objectKey)
        : null;
    return MediaAssetResponseDto.fromEntity(asset, url);
  }

  private resolveUrl(
    bucket: StorageBucket,
    objectKey: string,
  ): Promise<string> {
    return this.supabase.createSignedReadUrl(bucket, objectKey);
  }
}

function extensionForMime(mimeType: string, fileName?: string): string {
  if (fileName) {
    const match = /\.[a-zA-Z0-9]+$/.exec(fileName);
    if (match) return match[0].toLowerCase();
  }
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}
