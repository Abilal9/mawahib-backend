import { UserWithProfile } from '../repositories/user.repository';

export class UserResponseDto {
  id!: string;
  email!: string;
  accountType!: string;
  displayName!: string;
  username!: string;
  isVerified!: boolean;
  followersCount!: number;
  followingCount!: number;
  postsCount!: number;
  ratingAvg!: number;
  ratingCount!: number;
  bio!: string;
  title!: string | null;
  locationCity!: string | null;
  locationCountry!: string | null;
  avatarUrl!: string | null;
  coverUrl!: string | null;
  phoneE164!: string | null;
  phoneVerified!: boolean;
  emailVerified!: boolean;
  skills!: string[];
  createdAt!: string;
  updatedAt!: string;

  static fromEntity(user: UserWithProfile): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.accountType = user.accountType;
    dto.displayName = user.displayName;
    dto.username = user.username;
    dto.isVerified = user.isVerified;
    dto.followersCount = user.followersCount;
    dto.followingCount = user.followingCount;
    dto.postsCount = user.postsCount;
    dto.ratingAvg = Number(user.ratingAvg);
    dto.ratingCount = user.ratingCount;
    dto.bio = user.profile?.bio ?? '';
    dto.title = user.profile?.title ?? null;
    dto.locationCity = user.profile?.locationCity ?? null;
    dto.locationCountry = user.profile?.locationCountry ?? null;
    dto.avatarUrl = user.profile?.avatarUrl ?? null;
    dto.coverUrl = user.profile?.coverUrl ?? null;
    dto.phoneE164 = user.profile?.phoneE164 ?? null;
    dto.phoneVerified = user.profile?.phoneVerified ?? false;
    dto.emailVerified = user.profile?.emailVerified ?? false;
    dto.skills = user.skills.map((s) => s.skill);
    dto.createdAt = user.createdAt.toISOString();
    dto.updatedAt = user.updatedAt.toISOString();
    return dto;
  }
}
