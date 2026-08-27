import { UserWithProfile } from '../repositories/user.repository';

/**
 * Visitor-safe profile — never includes email, phoneE164, or verification flags.
 * Aligns with ExploreProfileDto + optional about sections for profile screens.
 */
export class PublicProfileDto {
  id!: string;
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
  countryCode!: string | null;
  locationCode!: string | null;
  locationCity!: string | null;
  locationCountry!: string | null;
  avatarUrl!: string | null;
  coverUrl!: string | null;
  skills!: string[];
  about!: {
    languages: Array<{
      id: string;
      name: string;
      level: string;
      flag?: string;
    }>;
    education: Array<{
      id: string;
      school: string;
      degree: string;
      field: string;
      years: string;
      gpa?: string;
      description?: string;
      logoColor?: string;
    }>;
    experience: Array<{
      id: string;
      title: string;
      company: string;
      type: string;
      years: string;
      description: string;
      logoColor?: string;
    }>;
    certifications: Array<{
      id: string;
      name: string;
      org: string;
      year: string;
    }>;
  } | null;
  createdAt!: string;
  updatedAt!: string;

  static fromEntity(user: UserWithProfile): PublicProfileDto {
    const dto = new PublicProfileDto();
    dto.id = user.id;
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
    dto.countryCode = user.profile?.countryCode ?? null;
    dto.locationCode = user.profile?.locationCode ?? null;
    dto.locationCity = user.profile?.locationCity ?? null;
    dto.locationCountry = user.profile?.locationCountry ?? null;
    dto.avatarUrl = user.profile?.avatarUrl ?? null;
    dto.coverUrl = user.profile?.coverUrl ?? null;
    dto.skills = user.skills.map((s) => s.skill);
    dto.about = normalizeAbout(user.profile?.aboutJson);
    dto.createdAt = user.createdAt.toISOString();
    dto.updatedAt = user.updatedAt.toISOString();
    return dto;
  }
}

function normalizeAbout(raw: unknown): PublicProfileDto['about'] {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  return {
    languages: Array.isArray(value.languages) ? (value.languages as never) : [],
    education: Array.isArray(value.education) ? (value.education as never) : [],
    experience: Array.isArray(value.experience)
      ? (value.experience as never)
      : [],
    certifications: Array.isArray(value.certifications)
      ? (value.certifications as never)
      : [],
  };
}
