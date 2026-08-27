import { PublicProfileDto } from './dto/public-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import type { UserWithProfile } from './repositories/user.repository';

describe('PublicProfileDto privacy', () => {
  const user = {
    id: 'u1',
    email: 'secret@example.com',
    accountType: 'talent',
    displayName: 'Secret User',
    username: 'secret_user',
    isVerified: true,
    followersCount: 1,
    followingCount: 2,
    postsCount: 3,
    ratingAvg: 4.5,
    ratingCount: 10,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    skills: [{ userId: 'u1', skill: 'Design', createdAt: new Date() }],
    profile: {
      userId: 'u1',
      bio: 'hi',
      title: 'Designer',
      countryCode: 'SA',
      locationCode: 'riyadh',
      locationCity: 'Riyadh',
      locationCountry: 'Saudi Arabia',
      avatarUrl: null,
      coverUrl: null,
      phoneE164: '+966501234567',
      phoneVerified: true,
      emailVerified: true,
      aboutJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as UserWithProfile;

  it('excludes email and phone from public DTO', () => {
    const pub = PublicProfileDto.fromEntity(user);
    expect(pub).not.toHaveProperty('email');
    expect(pub).not.toHaveProperty('phoneE164');
    expect(pub).not.toHaveProperty('phoneVerified');
    expect(pub).not.toHaveProperty('emailVerified');
    expect(pub.displayName).toBe('Secret User');
    expect(JSON.stringify(pub)).not.toMatch(/secret@example\.com|\+966501234567/);
  });

  it('owner DTO still includes private fields', () => {
    const me = UserResponseDto.fromEntity(user);
    expect(me.email).toBe('secret@example.com');
    expect(me.phoneE164).toBe('+966501234567');
  });
});
