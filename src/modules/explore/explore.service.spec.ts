import { PackageTier } from '@prisma/client';
import { MediaService } from '../media/media.service';
import { ExploreService, EXPLORE_SIGN_CONCURRENCY } from './explore.service';
import type {
  ExploreRepository,
  ExploreServiceRecord,
  ExploreUserRecord,
} from './repositories/explore.repository';

function user(partial: Partial<ExploreUserRecord> = {}): ExploreUserRecord {
  return {
    id: 'user-1',
    displayName: 'Layla AlHarbi',
    username: 'layla_talent_dev',
    accountType: 'talent',
    isVerified: true,
    followersCount: 1840,
    followingCount: 0,
    postsCount: 0,
    ratingAvg: 4.5 as ExploreUserRecord['ratingAvg'],
    ratingCount: 2,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    email: 'hidden@example.com',
    profile: {
      userId: 'user-1',
      bio: 'Photographer in Riyadh',
      title: 'Photographer',
      countryCode: 'SA',
      locationCode: 'riyadh',
      locationCity: 'Riyadh',
      locationCountry: 'Saudi Arabia',
      avatarUrl: 'https://cdn.example/avatar.jpg',
      coverUrl: null,
      phoneE164: '+966500000000',
      phoneVerified: false,
      emailVerified: true,
      aboutJson: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    skills: [
      {
        userId: 'user-1',
        skill: 'Photography',
        position: 0,
        createdAt: new Date('2026-01-01'),
      },
    ],
    ...partial,
  } as ExploreUserRecord;
}

function offering(
  mediaCount: number,
  partial: Partial<ExploreServiceRecord> = {},
): ExploreServiceRecord {
  return {
    id: 'svc-1',
    userId: 'user-1',
    title: 'Brand film',
    description: 'A film',
    category: 'Video',
    status: 'published',
    ratingAvg: 0 as ExploreServiceRecord['ratingAvg'],
    ratingCount: 0,
    currency: 'SAR',
    position: 0,
    deletedAt: null,
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    packages: [
      {
        id: 'pkg-1',
        offeringId: 'svc-1',
        tier: PackageTier.basic,
        price: 500 as ExploreServiceRecord['packages'][number]['price'],
        currency: 'SAR',
        deliveryLabel: '10 days',
        includes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    media: Array.from({ length: mediaCount }, (_, index) => ({
      id: `media-${index}`,
      offeringId: 'svc-1',
      mediaAssetId: `asset-${index}`,
      position: index,
      isVideo: false,
      createdAt: new Date(),
      mediaAsset: {
        id: `asset-${index}`,
        bucket: 'services',
        objectKey: `k-${index}`,
        status: 'ready',
      },
    })),
    user: user(),
    ...partial,
  } as ExploreServiceRecord;
}

describe('ExploreService', () => {
  const repo: jest.Mocked<ExploreRepository> = {
    searchTalents: jest.fn(),
    searchBusinesses: jest.fn(),
    loadUsers: jest.fn(),
    searchServices: jest.fn(),
    loadServices: jest.fn(),
  };
  const media = {
    resolveUrlForAsset: jest.fn(),
  };
  const service = new ExploreService(
    repo,
    media as unknown as MediaService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    repo.searchTalents.mockResolvedValue({ ids: ['user-1'], total: 1 });
    repo.searchBusinesses.mockResolvedValue([]);
    repo.loadUsers.mockResolvedValue([user()]);
    repo.searchServices.mockResolvedValue({ ids: [], total: 0 });
    repo.loadServices.mockResolvedValue([]);
  });

  it('excludes businesses from the default talent feed and passes the viewer', async () => {
    const page = await service.listTalents('viewer-1', {});
    expect(repo.searchTalents).toHaveBeenCalledWith(
      expect.objectContaining({
        viewerId: 'viewer-1',
        q: undefined,
        sort: 'recommended',
        skip: 0,
        take: 20,
      }),
    );
    expect(repo.searchBusinesses).not.toHaveBeenCalled();
    expect(page.businesses).toEqual([]);
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        id: 'user-1',
        displayName: 'Layla AlHarbi',
      }),
    );
    expect(page.items[0]).not.toHaveProperty('email');
    expect(page.items[0]).not.toHaveProperty('phoneE164');
  });

  it('returns studio matches only for the first page of a text search', async () => {
    repo.searchBusinesses.mockResolvedValue([
      user({ id: 'biz-1', accountType: 'business', displayName: 'Najd Studio' }),
    ]);
    const page = await service.listTalents('viewer-1', { q: 'najd' });
    expect(repo.searchBusinesses).toHaveBeenCalled();
    expect(page.businesses[0].accountType).toBe('business');

    repo.searchBusinesses.mockClear();
    await service.listTalents('viewer-1', { q: 'najd', skip: 20 });
    expect(repo.searchBusinesses).not.toHaveBeenCalled();
  });

  it('uses the provider rating and signs images with a concurrency cap', async () => {
    let active = 0;
    let peak = 0;
    media.resolveUrlForAsset.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return 'https://signed.example/image';
    });
    repo.searchServices.mockResolvedValue({ ids: ['svc-1'], total: 1 });
    repo.loadServices.mockResolvedValue([offering(12)]);

    const page = await service.listServices({ q: 'film' });

    expect(page.items[0].rating).toBe(4.5);
    expect(page.items[0].reviewCount).toBe(2);
    expect(page.items[0].provider.ratingAvg).toBe(4.5);
    expect(page.items[0].images).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(EXPLORE_SIGN_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(JSON.stringify(page.items[0])).not.toContain('hidden@example.com');
    expect(JSON.stringify(page.items[0])).not.toContain('+966500000000');
  });

  it('omits one unreadable image without failing the service page', async () => {
    media.resolveUrlForAsset
      .mockResolvedValueOnce('https://signed.example/ok')
      .mockRejectedValueOnce(new Error('storage down'));
    repo.searchServices.mockResolvedValue({ ids: ['svc-1'], total: 1 });
    repo.loadServices.mockResolvedValue([offering(2)]);

    const page = await service.listServices({});
    expect(page.items[0].images).toEqual(['https://signed.example/ok']);
  });

  it('does not invent a zero price when a service has no package', async () => {
    repo.searchServices.mockResolvedValue({ ids: ['svc-1'], total: 1 });
    repo.loadServices.mockResolvedValue([offering(0, { packages: [] })]);

    const page = await service.listServices({});
    expect(page.items[0].price).toBeNull();
  });

  it('keeps a real package price of zero', async () => {
    repo.searchServices.mockResolvedValue({ ids: ['svc-1'], total: 1 });
    repo.loadServices.mockResolvedValue([
      offering(0, {
        packages: [
          {
            ...offering(0).packages[0],
            price: 0 as ExploreServiceRecord['packages'][number]['price'],
          },
        ],
      }),
    ]);

    const page = await service.listServices({});
    expect(page.items[0].price).toBe(0);
  });
});
