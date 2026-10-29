import { AccountStatus, AccountType, PackageTier } from '@prisma/client';
import { EMPTY_REVIEW_SUMMARY } from '../reviews/review-summary';
import {
  toGuestActor,
  toGuestExploreService,
  toGuestExploreTalent,
  toGuestJob,
  toGuestPortfolio,
  toGuestPost,
  toGuestProfile,
  toGuestReview,
  toGuestService,
} from './guest.mappers';

const FORBIDDEN = [
  'email',
  'phone',
  'phoneE164',
  'phoneVerified',
  'emailVerified',
  'locationCode',
  'countryCode',
  'credentialUrl',
  'credentialId',
  'aboutJson',
  'isSaved',
  'isLiked',
  'relationship',
  'feedSource',
  'accountStatus',
  'deletedAt',
  'defaultCurrency',
  'skillSelections',
  'mediaAssetId',
  'mediaAssetIds',
  'applicationCount',
  'applications',
  'coverLetter',
  'myReview',
  'viewerId',
  'isVerified',
  'followersCount',
  'followingCount',
  'connectionsCount',
];

function assertGuestSafe(value: unknown) {
  const json = JSON.stringify(value);
  for (const key of FORBIDDEN) {
    expect(json).not.toContain(`"${key}"`);
  }
  expect(json).not.toMatch(/secret@example\.com|\+966501234567|credential-secret/);
}

const fatUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'secret@example.com',
  displayName: 'Ada',
  username: 'ada',
  accountType: AccountType.talent,
  accountStatus: AccountStatus.SUSPENDED,
  deletedAt: new Date(),
  isVerified: true,
  followersCount: 9,
  followingCount: 8,
  postsCount: 4,
  phoneE164: '+966501234567',
  profile: {
    avatarUrl: 'https://cdn.example/a.png',
    coverUrl: 'https://cdn.example/c.png',
    title: 'Designer',
    bio: 'Hello',
    locationCity: 'Riyadh',
    locationCountry: 'Saudi Arabia',
    locationCode: 'riyadh',
    countryCode: 'SA',
    phoneE164: '+966501234567',
    phoneVerified: true,
    emailVerified: true,
    aboutJson: {
      languages: [{ name: 'Arabic' }],
      education: [],
      experience: [],
      certifications: [
        {
          name: 'AWS',
          credentialUrl: 'https://secret.example/credential-secret',
          credentialId: 'credential-secret',
        },
      ],
    },
  },
  skills: [{ skill: 'Design', skillId: 'skill-secret' }],
};

describe('Guest DTO allowlists', () => {
  it('strips private profile fields and credential URLs', () => {
    const dto = toGuestProfile(fatUser, EMPTY_REVIEW_SUMMARY);
    assertGuestSafe(dto);
    expect(Object.keys(dto).sort()).toEqual(
      [
        'about',
        'accountType',
        'avatarUrl',
        'bio',
        'coverUrl',
        'displayName',
        'id',
        'locationCity',
        'locationCountry',
        'postsCount',
        'reviewSummary',
        'skills',
        'title',
        'username',
      ].sort(),
    );
    expect(JSON.stringify(dto.about)).not.toContain('credential');
  });

  it('keeps nested actor cards minimal', () => {
    const dto = toGuestActor(fatUser);
    assertGuestSafe(dto);
    expect(Object.keys(dto).sort()).toEqual(
      ['accountType', 'avatarUrl', 'displayName', 'id', 'title', 'username'].sort(),
    );
  });

  it('omits personalized post fields', () => {
    const dto = toGuestPost({
      id: 'p1',
      text: 'hello',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      author: fatUser,
      media: [{ url: 'https://signed.example/p.jpg', position: 0 }],
      likeCount: 3,
      commentCount: 1,
    });
    assertGuestSafe(dto);
    expect(dto).not.toHaveProperty('isLiked');
    expect(dto).not.toHaveProperty('isSaved');
    expect(dto).not.toHaveProperty('relationship');
  });

  it('omits job applications and saved state', () => {
    const dto = toGuestJob({
      id: 'j1',
      title: 'Open role',
      description: 'Build',
      companyName: 'Acme',
      employmentType: 'full_time',
      location: 'Riyadh',
      currency: 'SAR',
      pricingType: 'fixed',
      fixedAmount: 100,
      minAmount: null,
      maxAmount: null,
      salaryLabel: null,
      categoryId: null,
      customCategory: null,
      skills: ['Design'],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      postedAt: new Date('2026-01-01T00:00:00.000Z'),
      poster: fatUser,
    });
    assertGuestSafe(dto);
    expect(dto).not.toHaveProperty('status');
    expect(dto).not.toHaveProperty('isSaved');
  });

  it('maps published services without owner controls', () => {
    const dto = toGuestService({
      offering: {
        id: 's1',
        title: 'Logo',
        description: 'Brand',
        category: 'Design',
        categoryId: null,
        customCategory: null,
        currency: 'SAR',
        packages: [
          {
            tier: PackageTier.basic,
            price: 50,
            currency: 'SAR',
            deliveryLabel: '3 days',
            includes: ['1 concept'],
          },
        ],
        addons: [],
      },
      images: ['https://signed.example/s.jpg'],
      provider: fatUser,
    });
    assertGuestSafe(dto);
    expect(dto).not.toHaveProperty('status');
    expect(dto).not.toHaveProperty('position');
    expect(dto).not.toHaveProperty('isSaved');
  });

  it('maps portfolio without reorder metadata', () => {
    const dto = toGuestPortfolio({
      id: 'pf1',
      title: 'Work',
      description: 'Shown',
      images: ['https://signed.example/pf.jpg'],
    });
    assertGuestSafe(dto);
    expect(dto).not.toHaveProperty('position');
  });

  it('maps reviews without unpublished state', () => {
    const dto = toGuestReview({
      id: 'r1',
      rating: 5,
      body: 'Great',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      reviewer: fatUser,
      media: [{ url: 'https://signed.example/r.jpg', mimeType: 'image/jpeg' }],
    });
    assertGuestSafe(dto);
    expect(dto).not.toHaveProperty('myReview');
    expect(dto.reviewer).not.toHaveProperty('email');
  });

  it('maps explore cards without social state', () => {
    const talent = toGuestExploreTalent(fatUser, EMPTY_REVIEW_SUMMARY);
    const service = toGuestExploreService({
      id: 's1',
      title: 'Logo',
      description: 'Brand',
      category: 'Design',
      images: [],
      provider: fatUser,
    });
    assertGuestSafe(talent);
    assertGuestSafe(service);
    expect(service).not.toHaveProperty('isSaved');
  });
});
