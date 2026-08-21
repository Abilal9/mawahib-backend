import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
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
      countryCode: 'SA',
      locationCode: 'riyadh',
      avatarUrl: null,
      coverUrl: null,
      phoneE164: null,
      phoneVerified: false,
      emailVerified: false,
      aboutJson: null,
      createdAt: now,
      updatedAt: now,
    },
    skills: [],
    ...overrides,
  };
}

const trustedDefault = {
  email: 'talent@example.com',
  emailVerified: false,
  phoneVerified: false,
  phone: null as string | null,
  trusted: true,
};

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<UserRepository>;
  let supabase: { getAuthVerification: jest.Mock };

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      findByPhoneE164: jest.fn(),
      createWithProfile: jest.fn(),
      updateOwn: jest.fn(),
    };

    supabase = {
      getAuthVerification: jest.fn().mockResolvedValue({ ...trustedDefault }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: USER_REPOSITORY, useValue: repo },
        { provide: SupabaseService, useValue: supabase },
      ],
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

  it('getMe syncs emailVerified from trusted Supabase Auth', async () => {
    const existing = makeUser();
    const synced = makeUser({
      profile: {
        ...makeUser().profile!,
        emailVerified: true,
      },
    });
    repo.findById.mockResolvedValue(existing);
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      emailVerified: true,
    });
    repo.updateOwn.mockResolvedValue(synced);

    const me = await service.getMe({ sub: existing.id, email: existing.email });
    expect(repo.updateOwn).toHaveBeenCalledWith(existing.id, {
      emailVerified: true,
      phoneVerified: false,
    });
    expect(me.emailVerified).toBe(true);
  });

  it('bootstrap is idempotent when user exists', async () => {
    const existing = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
      },
    });
    repo.findById.mockResolvedValue(existing);
    const result = await service.bootstrap(
      { sub: existing.id, email: existing.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        phoneE164: '+966501234567',
      },
    );
    expect(result.id).toBe(existing.id);
    expect(repo.createWithProfile.mock.calls).toHaveLength(0);
  });

  it('bootstrap creates user once with phone', async () => {
    const created = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
      },
    });
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.createWithProfile.mockResolvedValue(created);

    const result = await service.bootstrap(
      { sub: created.id, email: created.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        locationCity: 'Riyadh',
        phoneE164: '+966501234567',
      },
    );

    expect(result.username).toBe('ada');
    expect(repo.createWithProfile.mock.calls).toHaveLength(1);
    expect(repo.createWithProfile.mock.calls[0][0].phoneE164).toBe(
      '+966501234567',
    );
    expect(repo.createWithProfile.mock.calls[0][0].email).toBe(
      'talent@example.com',
    );
    expect(repo.createWithProfile.mock.calls[0][0].emailVerified).toBe(false);
    expect(repo.createWithProfile.mock.calls[0][0].phoneVerified).toBe(false);
  });

  it('bootstrap prefers trusted Auth/JWT email over client email B', async () => {
    const created = makeUser({
      email: 'auth-a@example.com',
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
      },
    });
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.createWithProfile.mockResolvedValue(created);
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      email: 'auth-a@example.com',
    });

    await expect(
      service.bootstrap(
        { sub: created.id, email: 'auth-a@example.com' },
        {
          accountType: AccountType.talent,
          displayName: 'Ada',
          phoneE164: '+966501234567',
          email: 'client-b@example.com',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createWithProfile).not.toHaveBeenCalled();
  });

  it('bootstrap binds phoneVerified only when Auth phone matches Nest phone', async () => {
    const created = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966522222222',
        phoneVerified: false,
      },
    });
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.createWithProfile.mockResolvedValue(created);
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      phoneVerified: true,
      phone: '+966511111111',
    });

    await service.bootstrap(
      { sub: created.id, email: created.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        phoneE164: '+966522222222',
      },
    );

    expect(repo.createWithProfile.mock.calls[0][0].phoneVerified).toBe(false);
  });

  it('bootstrap sets phoneVerified when Auth verified phone matches exactly', async () => {
    const created = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966511111111',
        phoneVerified: true,
      },
    });
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.createWithProfile.mockResolvedValue(created);
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      phoneVerified: true,
      phone: '+966511111111',
    });

    await service.bootstrap(
      { sub: created.id, email: created.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        phoneE164: '+966511111111',
      },
    );

    expect(repo.createWithProfile.mock.calls[0][0].phoneVerified).toBe(true);
  });

  it('bootstrap ignores client emailVerified / phoneVerified forge attempts', async () => {
    const created = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
        emailVerified: false,
        phoneVerified: false,
      },
    });
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.createWithProfile.mockResolvedValue(created);
    supabase.getAuthVerification.mockResolvedValue({ ...trustedDefault });

    await service.bootstrap(
      { sub: created.id, email: created.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        phoneE164: '+966501234567',
        // @ts-expect-error — client must not be able to forge these
        emailVerified: true,
        phoneVerified: true,
      },
    );

    expect(repo.createWithProfile.mock.calls[0][0].emailVerified).toBe(false);
    expect(repo.createWithProfile.mock.calls[0][0].phoneVerified).toBe(false);
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
        {
          accountType: AccountType.talent,
          displayName: 'Ada',
          phoneE164: '+966501234567',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('bootstrap rejects duplicate phone', async () => {
    repo.findById.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByPhoneE164.mockResolvedValue(makeUser({ id: 'other' }));
    await expect(
      service.bootstrap(
        {
          sub: '11111111-1111-1111-1111-111111111111',
          email: 'new@example.com',
        },
        {
          accountType: AccountType.talent,
          displayName: 'Ada',
          phoneE164: '+966501234567',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('bootstrap syncs missing phone and trusted emailVerified on existing user', async () => {
    const existing = makeUser();
    const afterPhone = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
        emailVerified: false,
        phoneVerified: false,
      },
    });
    const afterVerify = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
        emailVerified: true,
        phoneVerified: false,
      },
    });
    repo.findById.mockResolvedValue(existing);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.updateOwn
      .mockResolvedValueOnce(afterPhone)
      .mockResolvedValueOnce(afterVerify);
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      emailVerified: true,
    });

    const result = await service.bootstrap(
      { sub: existing.id, email: existing.email },
      {
        accountType: AccountType.talent,
        displayName: 'Ada',
        phoneE164: '+966501234567',
      },
    );

    expect(repo.updateOwn.mock.calls[0]).toEqual([
      existing.id,
      { phoneE164: '+966501234567', phoneVerified: false },
    ]);
    expect(repo.updateOwn.mock.calls[1]).toEqual([
      existing.id,
      { emailVerified: true, phoneVerified: false },
    ]);
    expect(result.phoneE164).toBe('+966501234567');
    expect(result.emailVerified).toBe(true);
  });

  it('updateMe clears phoneVerified when phone changes to a different number', async () => {
    const existing = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966511111111',
        phoneVerified: true,
      },
    });
    const afterChange = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966522222222',
        phoneVerified: false,
      },
    });
    repo.findById.mockResolvedValue(existing);
    repo.findByPhoneE164.mockResolvedValue(null);
    repo.updateOwn.mockResolvedValue(afterChange);
    // Auth still has A verified — must not re-verify B.
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      phoneVerified: true,
      phone: '+966511111111',
    });

    const result = await service.updateMe(
      { sub: existing.id, email: existing.email },
      { phoneE164: '+966522222222' },
    );

    expect(repo.updateOwn.mock.calls[0][1]).toMatchObject({
      phoneE164: '+966522222222',
      phoneVerified: false,
    });
    expect(result.phoneVerified).toBe(false);
  });

  it('getMe does not inherit Auth phoneVerified onto a different Nest phone', async () => {
    const existing = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966522222222',
        phoneVerified: true,
      },
    });
    const cleared = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966522222222',
        phoneVerified: false,
      },
    });
    repo.findById.mockResolvedValue(existing);
    repo.updateOwn.mockResolvedValue(cleared);
    supabase.getAuthVerification.mockResolvedValue({
      ...trustedDefault,
      phoneVerified: true,
      phone: '+966511111111',
    });

    const me = await service.getMe({ sub: existing.id, email: existing.email });
    expect(repo.updateOwn).toHaveBeenCalledWith(existing.id, {
      emailVerified: false,
      phoneVerified: false,
    });
    expect(me.phoneVerified).toBe(false);
  });

  it('updateMe does not accept client emailVerified or phoneVerified', async () => {
    const existing = makeUser({
      profile: {
        ...makeUser().profile!,
        phoneE164: '+966501234567',
      },
    });
    repo.findById.mockResolvedValue(existing);
    repo.updateOwn.mockResolvedValue(existing);
    supabase.getAuthVerification.mockResolvedValue({ ...trustedDefault });

    await service.updateMe(
      { sub: existing.id, email: existing.email },
      {
        displayName: 'Ada Lovelace',
        // @ts-expect-error — stripped from DTO; must be ignored if smuggled
        emailVerified: true,
        phoneVerified: true,
      },
    );

    const patch = repo.updateOwn.mock.calls[0][1];
    expect(patch.emailVerified).toBeUndefined();
    expect(patch.phoneVerified).toBeUndefined();
    expect(patch.displayName).toBe('Ada Lovelace');
  });
});
