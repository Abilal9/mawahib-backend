import { MediaStatus } from '@prisma/client';
import { PortfolioProjectWithMedia } from '../repositories/portfolio.repository';

export class PortfolioProjectResponseDto {
  id!: string;
  title!: string;
  description!: string;
  images!: string[];
  mediaAssetIds!: string[];
  hasVideo!: boolean;
  videoIndex?: number;
  position!: number;
  createdAt!: string;
  updatedAt!: string;

  static fromEntity(
    project: PortfolioProjectWithMedia,
    urlsByAssetId: Map<string, string | null>,
  ): PortfolioProjectResponseDto {
    const dto = new PortfolioProjectResponseDto();
    dto.id = project.id;
    dto.title = project.title;
    dto.description = project.description;
    dto.position = project.position;
    dto.mediaAssetIds = project.media.map((m) => m.mediaAssetId);
    dto.images = project.media
      .map((m) => urlsByAssetId.get(m.mediaAssetId) ?? null)
      .filter((url): url is string => Boolean(url));
    const videoIdx = project.media.findIndex((m) => m.isVideo);
    dto.hasVideo = videoIdx >= 0;
    if (videoIdx >= 0) dto.videoIndex = videoIdx;
    dto.createdAt = project.createdAt.toISOString();
    dto.updatedAt = project.updatedAt.toISOString();
    return dto;
  }
}

export function isVideoMime(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

export function assetReady(status: MediaStatus): boolean {
  return status === MediaStatus.ready;
}
