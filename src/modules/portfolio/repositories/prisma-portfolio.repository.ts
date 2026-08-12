import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  CreatePortfolioProjectInput,
  PortfolioProjectWithMedia,
  PortfolioRepository,
  UpdatePortfolioProjectInput,
} from './portfolio.repository';

const mediaInclude = {
  media: {
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
};

@Injectable()
export class PrismaPortfolioRepository implements PortfolioRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByUser(userId: string): Promise<PortfolioProjectWithMedia[]> {
    return this.prisma.portfolioProject.findMany({
      where: { userId, deletedAt: null },
      include: mediaInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });
  }

  findById(id: string): Promise<PortfolioProjectWithMedia | null> {
    return this.prisma.portfolioProject.findFirst({
      where: { id, deletedAt: null },
      include: mediaInclude,
    });
  }

  async create(
    input: CreatePortfolioProjectInput,
  ): Promise<PortfolioProjectWithMedia> {
    return this.prisma.portfolioProject.create({
      data: {
        id: input.id,
        userId: input.userId,
        title: input.title,
        description: input.description,
        position: input.position,
        media: {
          create: input.media.map((m) => ({
            mediaAssetId: m.mediaAssetId,
            position: m.position,
            isVideo: m.isVideo,
          })),
        },
      },
      include: mediaInclude,
    });
  }

  async update(
    id: string,
    userId: string,
    input: UpdatePortfolioProjectInput,
  ): Promise<PortfolioProjectWithMedia> {
    const existing = await this.prisma.portfolioProject.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Portfolio project not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.media) {
        await tx.portfolioMedia.deleteMany({ where: { projectId: id } });
        await tx.portfolioMedia.createMany({
          data: input.media.map((m) => ({
            projectId: id,
            mediaAssetId: m.mediaAssetId,
            position: m.position,
            isVideo: m.isVideo,
          })),
        });
      }

      return tx.portfolioProject.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
        },
        include: mediaInclude,
      });
    });
  }

  async softDelete(id: string, userId: string): Promise<void> {
    const result = await this.prisma.portfolioProject.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Portfolio project not found');
    }
  }

  async reorder(userId: string, projectIds: string[]): Promise<void> {
    await this.prisma.$transaction(
      projectIds.map((id, index) =>
        this.prisma.portfolioProject.updateMany({
          where: { id, userId, deletedAt: null },
          data: { position: index },
        }),
      ),
    );
  }

  countByUser(userId: string): Promise<number> {
    return this.prisma.portfolioProject.count({
      where: { userId, deletedAt: null },
    });
  }
}
