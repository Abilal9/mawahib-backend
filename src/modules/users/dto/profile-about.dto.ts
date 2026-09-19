import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
  @MinLength(1)
  @MaxLength(40)
  level!: string;

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
  @MaxLength(160)
  school!: string;

  @IsString()
  @MaxLength(120)
  degree!: string;

  @IsString()
  @MaxLength(120)
  field!: string;

  @IsString()
  @MaxLength(64)
  years!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

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
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(160)
  company!: string;

  @IsString()
  @MaxLength(80)
  type!: string;

  @IsString()
  @MaxLength(64)
  years!: string;

  @IsString()
  @MaxLength(2000)
  description!: string;

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
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(160)
  org!: string;

  @IsString()
  @MaxLength(40)
  year!: string;
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
