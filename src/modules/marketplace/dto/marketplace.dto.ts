import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementStatus,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateJobListingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  location!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  salaryLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  exploreTag?: string;

  /** When true, create as open (published) instead of draft */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateJobListingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string | null;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  salaryLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  exploreTag?: string | null;
}

export class ListingTransitionDto {
  @IsEnum(JobListingStatus)
  @IsIn([
    JobListingStatus.open,
    JobListingStatus.archived,
    JobListingStatus.closed,
  ])
  status!: JobListingStatus;
}

export class ListJobListingsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  exploreTag?: string;

  @IsOptional()
  @IsEnum(JobListingStatus)
  status?: JobListingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  coverLetter?: string;
}

export class PatchApplicationDto {
  @IsEnum(JobApplicationStatus)
  @IsIn([
    JobApplicationStatus.under_review,
    JobApplicationStatus.accepted,
    JobApplicationStatus.rejected,
    JobApplicationStatus.withdrawn,
  ])
  status!: JobApplicationStatus;
}

export class EngagementTransitionDto {
  @IsEnum(WorkEngagementStatus)
  status!: WorkEngagementStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
