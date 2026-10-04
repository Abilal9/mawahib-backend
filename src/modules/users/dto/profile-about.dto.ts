import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const PROFILE_LANGUAGE_LEVELS = [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'NATIVE',
] as const;

export type ProfileLanguageLevel = (typeof PROFILE_LANGUAGE_LEVELS)[number];

export const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Freelance',
  'Contract',
  'Internship',
  'Self-employed',
  'Temporary',
  'Other',
] as const;

export const LOCATION_TYPES = ['On-site', 'Hybrid', 'Remote'] as const;

/** Reasonable Profile date year bounds for About structured dates. */
const YEAR_MIN = 1950;
const YEAR_MAX = 2100;

export class AboutLanguageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsIn([...PROFILE_LANGUAGE_LEVELS])
  level!: ProfileLanguageLevel;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  languageCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  flag?: string;
}

export class AboutEducationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  school!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  degree?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  field?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(YEAR_MIN)
  @Max(YEAR_MAX)
  startYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  endMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(YEAR_MIN)
  @Max(YEAR_MAX)
  endYear?: number;

  @IsOptional()
  @IsBoolean()
  currentlyStudying?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  grade?: string;

  /** @deprecated Prefer grade. Accepted for older clients. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** @deprecated Legacy display string — optional for compatibility only. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  years?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  logoColor?: string;
}

export class AboutExperienceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  company!: string;

  @IsOptional()
  @IsString()
  @IsIn([...EMPLOYMENT_TYPES])
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @IsIn([...LOCATION_TYPES])
  locationType?: (typeof LOCATION_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(YEAR_MIN)
  @Max(YEAR_MAX)
  startYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  endMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(YEAR_MIN)
  @Max(YEAR_MAX)
  endYear?: number;

  @IsOptional()
  @IsBoolean()
  currentlyWorking?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** @deprecated Prefer employmentType. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  /** @deprecated Legacy display string. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  years?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  logoColor?: string;
}

export class AboutCertificationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  issuingOrganization?: string;

  /** @deprecated Prefer issuingOrganization. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  org?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  issueMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(YEAR_MIN)
  @Max(YEAR_MAX)
  issueYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  expirationMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(YEAR_MIN)
  @Max(YEAR_MAX)
  expirationYear?: number;

  @IsOptional()
  @IsBoolean()
  doesNotExpire?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credentialId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  credentialUrl?: string | null;

  /** @deprecated Prefer issueYear. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  year?: string;
}

/** Structured About payload persisted to Profile.aboutJson. */
export class ProfileAboutDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AboutLanguageDto)
  languages?: AboutLanguageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AboutEducationDto)
  education?: AboutEducationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AboutExperienceDto)
  experience?: AboutExperienceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AboutCertificationDto)
  certifications?: AboutCertificationDto[];
}
