import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  AccountType,
  MediaPurpose,
  MediaStatus,
  PostVisibility,
} from '@prisma/client';
import { MediaService } from '../media/media.service';
import { ReviewClock } from '../reviews/review-clock';
import { ReviewsService } from '../reviews/reviews.service';
import { EMPTY_AGGREGATE, EMPTY_REVIEW_SUMMARY } from '../reviews/review-summary';
import { TaxonomyFilterService } from '../taxonomy/taxonomy-filter.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { PublicRepository } from './public.repository';
import { PublicService } from './public.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_ID = '44444444-4444-4444-8444-444444444444';

const discoverable = {
  id: USER_ID,
  displayName: 'Ada',
  username: 'ada',
  accountType: AccountType.talent,
  accountStatus: AccountStatus.ACTIVE,
  deletedAt: null,
  postsCount: 2,
  skills: [],
  profile: {
    avatarUrl: null,
    coverUrl: null,
    title: 'Designer',
    bio: '',
    locationCity: 'Riyadh',
    locationCountry: 'Saudi Arabia',
    aboutJson: null,
  },
};

function publicPost(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    text: 'hello',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    visibility: PostVisibility.public,
    author: discoverable,
    media: [],
    ...overrides,
  };
}

describe('PublicService', () => {
  const publicRepo = {
    findDiscoverableUser: jest.fn(),
    listPublicFeed: jest.fn(),
    findPublicPost: jest.fn(),
    listPublicUserPosts: jest.fn(),
    countLikesForPosts: jest.fn(),
    countCommentsForPosts: jest.fn(),
    listPublicUserServices: jest.fn(),
    findPublicService: jest.fn(),
    listPublicUserPortfolio: jest.fn(),
    listPublicOpenJobs: jest.fn(),
    findPublicOpenJob: jest.fn(),
    searchPublicTalents: jest.fn(),
    searchPublicServices: jest.fn(),
    loadDiscoverableUsers: jest.fn(),
    loadPublicServices: jest.fn(),
  };
  const media = {
    resolveUrlForAsset: jest.fn(),
    getSignedUrlForAsset: jest.fn(),
  };
  const reviews = {
    summarizeUsers: jest.fn(),
    summarizeServices: jest.fn(),
    listReceived: jest.fn(),
    listForService: jest.fn(),
  };
  const taxonomy = { list: jest.fn() };
  const taxonomyFilters = { resolveSearchSkillIds: jest.fn() };

  let service: PublicService;

  beforeEach(async () => {
    jest.resetAllMocks();
    publicRepo.countLikesForPosts.mockResolvedValue([]);
    publicRepo.countCommentsForPosts.mockResolvedValue([]);
    media.resolveUrlForAsset.mockResolvedValue(null);
    media.getSignedUrlForAsset.mockResolvedValue(null);
    reviews.summarizeUsers.mockResolvedValue(new Map());
    reviews.summarizeServices.mockResolvedValue(new Map());
    reviews.listReceived.mockResolvedValue({ items: [], nextCursor: null });
    reviews.listForService.mockResolvedValue({ items: [], nextCursor: null });
    taxonomy.list.mockResolvedValue({ categories: [] });
    taxonomyFilters.resolveSearchSkillIds.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PublicRepository, useValue: publicRepo },
        { provide: MediaService, useValue: media },
        { provide: ReviewsService, useValue: reviews },
        { provide: ReviewClock, useValue: { now: () => new Date('2026-10-29') } },
        { provide: TaxonomyService, useValue: taxonomy },
        { provide: TaxonomyFilterService, useValue: taxonomyFilters },
      ],
    }).compile();
    service = moduleRef.get(PublicService);
  });

  it('returns a public post and omits viewer flags', async () => {
    publicRepo.findPublicPost.mockResolvedValue(publicPost());
    const dto = await service.getPost(POST_ID);
    expect(dto.id).toBe(POST_ID);
    expect(dto).not.toHaveProperty('isLiked');
    expect(dto).not.toHaveProperty('isSaved');
  });

  it('hides connection-only and unpublished posts as 404', async () => {
    publicRepo.findPublicPost.mockResolvedValue(null);
    await expect(service.getPost(POST_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s suspended or deleted profiles', async () => {
    publicRepo.findDiscoverableUser.mockResolvedValue(null);
    await expect(service.getProfile(USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a discoverable profile without private fields', async () => {
    publicRepo.findDiscoverableUser.mockResolvedValue(discoverable);
    reviews.summarizeUsers.mockResolvedValue(
      new Map([[USER_ID, EMPTY_REVIEW_SUMMARY]]),
    );
    const dto = await service.getProfile(USER_ID);
    expect(dto.id).toBe(USER_ID);
    expect(dto).not.toHaveProperty('email');
    expect(dto).not.toHaveProperty('locationCode');
  });

  it('lists only open jobs through the dedicated query', async () => {
    publicRepo.listPublicOpenJobs.mockResolvedValue([]);
    await service.listJobs({ take: 20, skip: 0, q: 'ab' });
    expect(publicRepo.listPublicOpenJobs).toHaveBeenCalledWith({
      take: 20,
      skip: 0,
      q: 'ab',
    });
    expect(publicRepo.listPublicOpenJobs.mock.calls[0][0]).not.toHaveProperty(
      'status',
    );
  });

  it('404s draft or closed job ids', async () => {
    publicRepo.findPublicOpenJob.mockResolvedValue(null);
    await expect(service.getJob(JOB_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s unpublished services', async () => {
    publicRepo.findPublicService.mockResolvedValue(null);
    await expect(service.getService(SERVICE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reuses published review listing and signs review media after that', async () => {
    publicRepo.findDiscoverableUser.mockResolvedValue(discoverable);
    reviews.listReceived.mockResolvedValue({
      items: [
        {
          id: 'rev-1',
          rating: 5,
          body: 'Great',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          reviewer: {
            id: USER_ID,
            displayName: 'Ada',
            username: 'ada',
            accountType: AccountType.talent,
            profile: { avatarUrl: null, title: null },
          },
          media: [
            {
              mediaAssetId: 'asset-1',
              mediaAsset: {
                mimeType: 'image/jpeg',
                purpose: MediaPurpose.review,
                status: MediaStatus.ready,
                deletedAt: null,
              },
            },
          ],
        },
      ],
      nextCursor: null,
    });
    media.getSignedUrlForAsset.mockResolvedValue('https://signed.example/r.jpg');
    const page = await service.listUserReviews(USER_ID, { take: 20 });
    expect(reviews.listReceived).toHaveBeenCalled();
    expect(media.getSignedUrlForAsset).toHaveBeenCalledWith('asset-1');
    expect(page.items[0]).not.toHaveProperty('email');
    expect(page.items[0].reviewer).not.toHaveProperty('phoneE164');
  });

  it('does not list reviews for a hidden user', async () => {
    publicRepo.findDiscoverableUser.mockResolvedValue(null);
    await expect(
      service.listUserReviews(USER_ID, { take: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(reviews.listReceived).not.toHaveBeenCalled();
  });

  it('does not list service reviews unless the service is public', async () => {
    publicRepo.findPublicService.mockResolvedValue(null);
    await expect(
      service.listServiceReviews(SERVICE_ID, { take: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(reviews.listForService).not.toHaveBeenCalled();
  });

  it('does not sign private-purpose media attached to a public parent', async () => {
    publicRepo.findDiscoverableUser.mockResolvedValue(discoverable);
    publicRepo.listPublicUserPortfolio.mockResolvedValue([
      {
        id: 'pf1',
        title: 'Work',
        description: 'Shown',
        media: [
          {
            mediaAsset: {
              bucket: 'messages',
              objectKey: 'msg/1',
              status: MediaStatus.ready,
              purpose: MediaPurpose.message,
              deletedAt: null,
            },
          },
        ],
      },
    ]);
    const items = await service.listUserPortfolio(USER_ID);
    expect(media.resolveUrlForAsset).not.toHaveBeenCalled();
    expect(items[0].images).toEqual([]);
  });

  it('keeps a published review visible with a Guest-safe reviewer card', async () => {
    publicRepo.findDiscoverableUser.mockResolvedValue(discoverable);
    reviews.listReceived.mockResolvedValue({
      items: [
        {
          id: 'rev-1',
          rating: 5,
          body: 'Great',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          reviewer: {
            id: USER_ID,
            email: 'secret@example.com',
            displayName: 'Ada',
            username: 'ada',
            accountType: AccountType.talent,
            profile: { avatarUrl: null, title: null, phoneE164: '+966501234567' },
          },
          media: [],
        },
      ],
      nextCursor: null,
    });
    const page = await service.listUserReviews(USER_ID, { take: 20 });
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page.items[0])).not.toMatch(
      /secret@example\.com|\+966501234567/,
    );
  });

  it('explore talents never request viewer saved state', async () => {
    publicRepo.searchPublicTalents.mockResolvedValue([USER_ID]);
    publicRepo.loadDiscoverableUsers.mockResolvedValue([discoverable]);
    await service.listExploreTalents({ take: 20, skip: 0 });
    expect(taxonomyFilters.resolveSearchSkillIds).toHaveBeenCalled();
    expect(JSON.stringify(publicRepo.searchPublicTalents.mock.calls[0][0])).not.toContain(
      'viewerId',
    );
  });

  it('explore services omit isSaved', async () => {
    publicRepo.searchPublicServices.mockResolvedValue([SERVICE_ID]);
    publicRepo.loadPublicServices.mockResolvedValue([
      {
        id: SERVICE_ID,
        title: 'Logo',
        description: 'Brand',
        category: 'Design',
        media: [],
        user: discoverable,
      },
    ]);
    reviews.summarizeServices.mockResolvedValue(
      new Map([[SERVICE_ID, EMPTY_AGGREGATE]]),
    );
    const page = await service.listExploreServices({ take: 20, skip: 0 });
    expect(page.items[0]).not.toHaveProperty('isSaved');
  });
});
