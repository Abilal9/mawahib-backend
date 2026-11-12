import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, ServiceOfferingStatus } from '@prisma/client';
import { MediaService } from '../media/media.service';
import { ReviewClock } from '../reviews/review-clock';
import { ReviewsService } from '../reviews/reviews.service';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import { SERVICE_OFFERING_REPOSITORY } from './repositories/service-offering.repository';
import { ServicesService } from './services.service';

describe('service review access', () => {
  const offerings = { findById: jest.fn() };
  const users = { findById: jest.fn() };
  const media = { getSignedUrlForAsset: jest.fn() };
  const reviews = {
    listForService: jest.fn(),
    contextLabel: jest.fn(() => 'Logo design'),
  };
  let service: ServicesService;

  const offering = (extras: Record<string, unknown> = {}) => ({
    id: 'svc-1',
    userId: 'owner',
    status: ServiceOfferingStatus.published,
    deletedAt: null,
    staffHiddenAt: null,
    ...extras,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    reviews.listForService.mockResolvedValue({
      items: [{
        id: 'review-1',
        rating: 5,
        body: 'Helpful',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        reviewer: {
          id: 'client',
          displayName: 'Client',
          username: 'client',
          isVerified: false,
          profile: { avatarUrl: null, title: null },
        },
        media: [{ id: 'media-1', mediaAssetId: 'asset-1', mediaAsset: { mimeType: 'image/jpeg' } }],
      }],
      nextCursor: null,
    });
    media.getSignedUrlForAsset.mockResolvedValue('https://signed.example/review.jpg');
    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: SERVICE_OFFERING_REPOSITORY, useValue: offerings },
        { provide: USER_REPOSITORY, useValue: users },
        { provide: MediaService, useValue: media },
        { provide: ReviewsService, useValue: reviews },
        { provide: ReviewClock, useValue: { now: () => new Date('2026-11-12T00:00:00.000Z') } },
      ],
    }).compile();
    service = module.get(ServicesService);
  });

  it('signs review media for a stranger only when the service is publicly eligible', async () => {
    offerings.findById.mockResolvedValue(offering());
    users.findById.mockResolvedValue({ deletedAt: null, accountStatus: AccountStatus.ACTIVE });

    const page = await service.listReviews('svc-1', {}, 'stranger');

    expect(page.items[0].media[0].url).toBe('https://signed.example/review.jpg');
    expect(media.getSignedUrlForAsset).toHaveBeenCalledWith('asset-1');
  });

  it.each([
    { staffHiddenAt: new Date('2026-11-12T00:00:00.000Z'), accountStatus: AccountStatus.ACTIVE },
    { status: ServiceOfferingStatus.draft, accountStatus: AccountStatus.ACTIVE },
    { status: ServiceOfferingStatus.archived, accountStatus: AccountStatus.ACTIVE },
    { accountStatus: AccountStatus.SUSPENDED },
  ])('does not read or sign reviews for an ineligible service', async (extras) => {
    offerings.findById.mockResolvedValue(offering(extras));
    users.findById.mockResolvedValue({
      deletedAt: null,
      accountStatus: extras.accountStatus,
    });

    await expect(service.listReviews('svc-1', {}, 'stranger')).rejects.toBeInstanceOf(NotFoundException);
    expect(reviews.listForService).not.toHaveBeenCalled();
    expect(media.getSignedUrlForAsset).not.toHaveBeenCalled();
  });

  it('lets the owner read reviews on a hidden service without treating it as public', async () => {
    offerings.findById.mockResolvedValue(offering({
      staffHiddenAt: new Date('2026-11-12T00:00:00.000Z'),
    }));

    await expect(service.listReviews('svc-1', {}, 'owner')).resolves.toMatchObject({
      items: [{ id: 'review-1' }],
    });
    expect(users.findById).not.toHaveBeenCalled();
  });
});
