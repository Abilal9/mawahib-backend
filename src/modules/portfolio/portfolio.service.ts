import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MediaService } from '../media/media.service';
import {
  CreatePortfolioProjectDto,
  ReorderPortfolioDto,
  UpdatePortfolioProjectDto,
} from './dto/portfolio.dto';
import {
  PortfolioProjectResponseDto,
  isVideoMime,
} from './dto/portfolio-response.dto';
import { PORTFOLIO_REPOSITORY } from './repositories/portfolio.repository';
import type {
  PortfolioProjectWithMedia,
  PortfolioRepository,
} from './repositories/portfolio.repository';

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolio: PortfolioRepository,
    private readonly mediaService: MediaService,
  ) {}

  async listMine(userId: string): Promise<PortfolioProjectResponseDto[]> {
    const projects = await this.portfolio.listByUser(userId);
    return this.mapMany(projects);
  }

  async listByUser(userId: string): Promise<PortfolioProjectResponseDto[]> {
    const projects = await this.portfolio.listByUser(userId);
    return this.mapMany(projects);
  }

  async create(
    userId: string,
    dto: CreatePortfolioProjectDto,
  ): Promise<PortfolioProjectResponseDto> {
    const mediaIds = dto.media.map((m) => m.mediaAssetId);
    const assets = await this.mediaService.requireReadyOwnedAssets(
      userId,
      mediaIds,
    );
    const byId = new Map(assets.map((a) => [a.id, a]));
    const count = await this.portfolio.countByUser(userId);
    const created = await this.portfolio.create({
      id: randomUUID(),
      userId,
      title: dto.title.trim(),
      description: (dto.description ?? '').trim(),
      position: count,
      media: mediaIds.map((mediaAssetId, position) => ({
        mediaAssetId,
        position,
        isVideo: isVideoMime(byId.get(mediaAssetId)!.mimeType),
      })),
    });
    return this.mapOne(created);
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdatePortfolioProjectDto,
  ): Promise<PortfolioProjectResponseDto> {
    const existing = await this.portfolio.findById(projectId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Portfolio project not found');
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException('You do not own this portfolio project');
    }

    let media:
      | Array<{ mediaAssetId: string; position: number; isVideo: boolean }>
      | undefined;
    if (dto.media) {
      const mediaIds = dto.media.map((m) => m.mediaAssetId);
      const assets = await this.mediaService.requireReadyOwnedAssets(
        userId,
        mediaIds,
      );
      const byId = new Map(assets.map((a) => [a.id, a]));
      media = mediaIds.map((mediaAssetId, position) => ({
        mediaAssetId,
        position,
        isVideo: isVideoMime(byId.get(mediaAssetId)!.mimeType),
      }));
    }

    const updated = await this.portfolio.update(projectId, userId, {
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      media,
    });
    return this.mapOne(updated);
  }

  async remove(userId: string, projectId: string): Promise<void> {
    await this.portfolio.softDelete(projectId, userId);
  }

  async reorder(
    userId: string,
    dto: ReorderPortfolioDto,
  ): Promise<PortfolioProjectResponseDto[]> {
    const existing = await this.portfolio.listByUser(userId);
    const existingIds = new Set(existing.map((p) => p.id));
    if (
      dto.projectIds.length !== existing.length ||
      dto.projectIds.some((id) => !existingIds.has(id))
    ) {
      throw new ForbiddenException(
        'projectIds must include each of your portfolio projects exactly once',
      );
    }
    await this.portfolio.reorder(userId, dto.projectIds);
    return this.listMine(userId);
  }

  private async mapMany(
    projects: PortfolioProjectWithMedia[],
  ): Promise<PortfolioProjectResponseDto[]> {
    return Promise.all(projects.map((p) => this.mapOne(p)));
  }

  private async mapOne(
    project: PortfolioProjectWithMedia,
  ): Promise<PortfolioProjectResponseDto> {
    const urlsByAssetId = new Map<string, string | null>();
    await Promise.all(
      project.media.map(async (m) => {
        const url = await this.mediaService.resolveUrlForAsset(m.mediaAsset);
        urlsByAssetId.set(m.mediaAssetId, url);
      }),
    );
    return PortfolioProjectResponseDto.fromEntity(project, urlsByAssetId);
  }
}
