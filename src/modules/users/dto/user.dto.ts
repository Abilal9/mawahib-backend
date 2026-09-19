import { AccountType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsPhoneE164 } from '../../../common/validation/phone-e164';
import { SUPPORTED_COUNTRY_CODES } from '../../../common/location/geo';
import { ProfileAboutDto } from './profile-about.dto';

/** Allow explicit null clears; empty string → null. */
function emptyToNull({ value }: { value: unknown }) {
  if (value === '') return null;
  return value;
}

export class BootstrapAuthDto {
  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsIn([...SUPPORTED_COUNTRY_CODES])
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  locationCode?: string;

  /** @deprecated prefer countryCode + locationCode */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationCity?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** Required when creating a new profile; optional on idempotent re-bootstrap. */
  @IsOptional()
  @IsString()
  @IsPhoneE164()
  phoneE164?: string;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsIn([...SUPPORTED_COUNTRY_CODES])
  countryCode?: string | null;

  @ValidateIf((o: UpdateMeDto) => o.countryCode != null && o.countryCode !== '')
  @IsString()
  @MaxLength(64)
  locationCode?: string | null;

  /** @deprecated prefer countryCode + locationCode */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationCity?: string | null;

  /** @deprecated prefer countryCode + locationCode */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationCountry?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v != null)
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  avatarUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v != null)
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  coverUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  skills?: string[];

  /** Structured About → Profile.aboutJson. Null clears. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileAboutDto)
  about?: ProfileAboutDto | null;

  @IsOptional()
  @IsString()
  @IsPhoneE164()
  phoneE164?: string | null;
}
