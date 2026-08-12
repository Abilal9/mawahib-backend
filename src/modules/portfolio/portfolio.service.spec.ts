import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { MediaStatus, PackageTier } from '@prisma/client';
import { PortfolioService } from './portfolio.service';
import { PORTFOLIO_REPOSITORY } from './repositories/portfolio.repository';
import { MediaService } from '../media/media.service';

describe('PortfolioService', () => {
  let service: PortfolioService;
  const portfolio = {
    listByUser: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    reorder: jest.fn(),
    countByUser: jest.fn(),
  };
  const mediaService = {
    requireReadyOwnedAssets: jest.fn(),
    resolveUrlForAsset: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: PORTFOLIO_REPOSITORY, useValue: portfolio },
        { provide: MediaService, useValue: mediaService },
      ],
    }).compile();
    service = module.get(PortfolioService);
  });

  it('creates a portfolio project with ordered media', async () => {
    mediaService.requireReadyOwnedAssets.mockResolvedValue([
      {
        id: 'm1',
        mimeType: 'image/jpeg',
        status: MediaStatus.ready,
      },
    ]);
    portfolio.countByUser.mockResolvedValue(0);
    const created = {
      id: 'p1',
      userId: 'u1',
      title: 'Project',
      description: 'Desc',
      position: 0,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      media: [
        {
          id: 'pm1',
          projectId: 'p1',
          mediaAssetId: 'm1',
          position: 0,
          isVideo: false,
          createdAt: new Date(),
          mediaAsset: {
            id: 'm1',
            ownerId: 'u1',
            bucket: 'portfolio',
            objectKey: 'u1/m1.jpg',
            mimeType: 'image/jpeg',
            byteSize: BigInt(10),
            purpose: 'portfolio',
            status: MediaStatus.ready,
            width: null,
            height: null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
    };
    portfolio.create.mockResolvedValue(created);
    mediaService.resolveUrlForAsset.mockResolvedValue('https://cdn/x.jpg');

    const result = await service.create('u1', {
      title: 'Project',
      description: 'Desc',
      media: [{ mediaAssetId: 'm1' }],
    });

    expect(result.images).toEqual(['https://cdn/x.jpg']);
    expect(portfolio.create).toHaveBeenCalled();
  });

  it('forbids update of another users project', async () => {
    portfolio.findById.mockResolvedValue({
      id: 'p1',
      userId: 'other',
      deletedAt: null,
      media: [],
    });
    await expect(
      service.update('u1', 'p1', { title: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('tier label sanity', () => {
  it('includes basic tier enum', () => {
    expect(PackageTier.basic).toBe('basic');
  });
});
