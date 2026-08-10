import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { UsersService } from './users.service';
import {
  USER_REPOSITORY,
  UserRepository,
  UserWithProfile,
} from './repositories/user.repository';

function makeUser(overrides: Partial<UserWithProfile> = {}): UserWithProfile {
  const now = new Date();
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'talent@example.com',
    accountType: AccountType.talent,
    displayName: 'Ada',
    username: 'ada',
    isVerified: false,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    ratingAvg: 0 as unknown as UserWithProfile['ratingAvg'],
    ratingCount: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    profile: {
      userId: '11111111-1111-1111-1111-111111111111',
      bio: '',
      title: null,
      locationCity: 'Riyadh',
      locationCountry: null,
      avatarUrl: null,
      coverUrl: null,
      createdAt: now,
      updatedAt: now,
    },
    skills: [],
    ...overrides,
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<UserRepository>;

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      createWithProfile: jest.fn(),
      updateOwn: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: USER_REPOSITORY, useValue: repo }],
    }).compile();

    service = module.get(UsersService);
  });

  it('getMe returns mapped user', async () => {
    repo.findById.mockResolvedValue(makeUser());
    const me = await service.getMe({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'talent@example.com',
    });
    expect(me.displayName).toBe('Ada');
    expect(me.locationCity).toBe('Riyadh');
  });

  it('getMe throws when not bootstrapped', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.getMe({ sub: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bootstrap is idempotent when user exists', async () => {
    const existing = makeUser();
    repo.findById.mockResolvedValue(existing);
    const result = await service.bootstrap(
      { sub: existing.id, email: existing.email },
      { accountType: AccountType.talent, displayName: 'Ada' },
    );
    expect(result.id).toBe(existing.id);
    expect(repo.createWithProfile.mock.calls).toHaveLength(0);
  });

  it('bootstrap creates user once', async () => {
    const created = makeUser();
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.createWithProfile.mockResolvedValue(created);

    const result = await service.bootstrap(
      { sub: created.id, email: created.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        locationCity: 'Riyadh',
      },
    );

    expect(result.username).toBe('ada');
    expect(repo.createWithProfile.mock.calls).toHaveLength(1);
  });

  it('bootstrap rejects duplicate email', async () => {
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(makeUser({ id: 'other' }));
    await expect(
      service.bootstrap(
        {
          sub: '11111111-1111-1111-1111-111111111111',
          email: 'ada@example.com',
        },
        { accountType: AccountType.talent, displayName: 'Ada' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
