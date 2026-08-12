import { MediaAsset } from '@prisma/client';

export class UploadSessionResponseDto {
  mediaAssetId!: string;
  bucket!: string;
  objectKey!: string;
  uploadUrl!: string;
  token!: string;
  purpose!: string;
  mimeType!: string;
  byteSize!: number;

  static create(input: {
    asset: MediaAsset;
    uploadUrl: string;
    token: string;
  }): UploadSessionResponseDto {
    const dto = new UploadSessionResponseDto();
    dto.mediaAssetId = input.asset.id;
    dto.bucket = input.asset.bucket;
    dto.objectKey = input.asset.objectKey;
    dto.uploadUrl = input.uploadUrl;
    dto.token = input.token;
    dto.purpose = input.asset.purpose;
    dto.mimeType = input.asset.mimeType;
    dto.byteSize = Number(input.asset.byteSize);
    return dto;
  }
}

export class MediaAssetResponseDto {
  id!: string;
  bucket!: string;
  objectKey!: string;
  mimeType!: string;
  byteSize!: number;
  purpose!: string;
  status!: string;
  url!: string | null;
  createdAt!: string;

  static fromEntity(
    asset: MediaAsset,
    url: string | null,
  ): MediaAssetResponseDto {
    const dto = new MediaAssetResponseDto();
    dto.id = asset.id;
    dto.bucket = asset.bucket;
    dto.objectKey = asset.objectKey;
    dto.mimeType = asset.mimeType;
    dto.byteSize = Number(asset.byteSize);
    dto.purpose = asset.purpose;
    dto.status = asset.status;
    dto.url = url;
    dto.createdAt = asset.createdAt.toISOString();
    return dto;
  }
}
