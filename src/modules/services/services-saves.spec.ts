import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ServiceOfferingStatus } from '@prisma/client';
import { MediaService } from '../media/media.service';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import { ReviewClock } from '../reviews/review-clock';
import { ReviewsService } from '../reviews/reviews.service';
import { ServicesService } from './services.service';
import { SERVICE_OFFERING_REPOSITORY } from './repositories/service-offering.repository';

describe('ServicesService saves', () => {
  const offerings = {
    listByUser: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    reorder: jest.fn(),
    countByUser: jest.fn(),
    findSaveTarget: jest.fn(),
    createServiceSave: jest.fn(),
    deleteServiceSave: jest.fn(),
    listServiceSaveIds: jest.fn(),
    listSavedServices: jest.fn(),
  };
  let service: ServicesService;

  const target = (
    status: ServiceOfferingStatus,
    extras?: { deletedAt?: Date | null; ownerDeletedAt?: Date | null },
  ) => ({
    id: 'svc-1',
    status,
    deletedAt: extras?.deletedAt ?? null,
    user: { deletedAt: extras?.ownerDeletedAt ?? null },
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    offerings.listServiceSaveIds.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: SERVICE_OFFERING_REPOSITORY, useValue: offerings },
        { provide: USER_REPOSITORY, useValue: { findById: jest.fn() } },
        {
          provide: MediaService,
          useValue: { resolveUrlForAsset: jest.fn() },
        },
        {
          provide: ReviewsService,
          useValue: {
            summarizeServices: jest.fn(async () => new Map()),
          },
        },
        {
          provide: ReviewClock,
          useValue: { now: () => new Date('2026-10-01T00:00:00.000Z') },
        },
      ],
    }).compile();
    service = module.get(ServicesService);
  });

  it('saves a published service and swallows only a unique violation', async () => {
    offerings.findSaveTarget.mockResolvedValue(
      target(ServiceOfferingStatus.published),
    );
    await expect(service.save('viewer', 'svc-1')).resolves.toEqual({
      isSaved: true,
    });
    offerings.createServiceSave.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.save('viewer', 'svc-1')).resolves.toEqual({
      isSaved: true,
    });
    expect(offerings.createServiceSave).toHaveBeenCalledWith('svc-1', 'viewer');
  });

  it('propagates unexpected database errors', async () => {
    offerings.findSaveTarget.mockResolvedValue(
      target(ServiceOfferingStatus.published),
    );
    offerings.createServiceSave.mockRejectedValue(new Error('db down'));
    await expect(service.save('viewer', 'svc-1')).rejects.toThrow('db down');
  });

  it.each([ServiceOfferingStatus.draft, ServiceOfferingStatus.archived])(
    'rejects %s even for the owner',
    async (status) => {
      offerings.findSaveTarget.mockResolvedValue(target(status));
      await expect(service.save('owner', 'svc-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('rejects a soft-deleted service or a deleted owner', async () => {
    offerings.findSaveTarget.mockResolvedValue(
      target(ServiceOfferingStatus.published, { deletedAt: new Date() }),
    );
    await expect(service.save('viewer', 'svc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    offerings.findSaveTarget.mockResolvedValue(
      target(ServiceOfferingStatus.published, { ownerDeletedAt: new Date() }),
    );
    await expect(service.save('viewer', 'svc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('unsaves without a visibility check', async () => {
    await expect(service.unsave('viewer', 'svc-1')).resolves.toEqual({
      isSaved: false,
    });
    expect(offerings.findSaveTarget).not.toHaveBeenCalled();
    expect(offerings.deleteServiceSave).toHaveBeenCalledWith('svc-1', 'viewer');
  });

  it('marks visitor profile services from one batch lookup', async () => {
    offerings.listByUser.mockResolvedValue([
      offering('svc-1'),
      offering('svc-2'),
    ]);
    offerings.listServiceSaveIds.mockResolvedValue(['svc-2']);
    const items = await service.listByUser('owner', 'viewer');
    expect(offerings.listServiceSaveIds).toHaveBeenCalledTimes(1);
    expect(offerings.listServiceSaveIds).toHaveBeenCalledWith('viewer', [
      'svc-1',
      'svc-2',
    ]);
    expect(items.map((item) => item.isSaved)).toEqual([false, true]);
  });

  it('keeps saved-list order and does not drop rows the query returned', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');
    offerings.listSavedServices.mockResolvedValue([
      { serviceId: 'svc-b', createdAt, service: offering('svc-b') },
      { serviceId: 'svc-a', createdAt, service: offering('svc-a') },
    ]);
    const page = await service.listSaved('viewer', undefined, 1);
    expect(offerings.listSavedServices).toHaveBeenCalledWith('viewer', null, 2);
    expect(page.items.map((item) => item.id)).toEqual(['svc-b']);
    expect(page.items[0].isSaved).toBe(true);
    expect(page.items[0].userId).toBe('owner');
    expect(page.items[0].savedAt).toBe(createdAt.toISOString());
    expect(page.hasMore).toBe(true);
  });
});

function offering(id: string) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    userId: 'owner',
    title: 'Film',
    description: '',
    category: null,
    categoryId: null,
    customCategory: null,
    status: ServiceOfferingStatus.published,
    currency: 'SAR',
    position: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    packages: [],
    addons: [],
    media: [],
    taxonomyCategory: null,
    taxonomySkills: [],
  };
}
