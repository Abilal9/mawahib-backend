import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  PackageTier,
  WorkEngagementStatus,
  WorkRequestStatus,
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
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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

/** Negotiable terms carried by every work request, whatever its source. */
export class WorkRequestTermsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  scope?: string;

  /** Free-text price label (e.g. "SAR 8,000 project") — money moves in Phase 5 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  price?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deadlineLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class CreateServiceWorkRequestDto {
  @IsUUID()
  serviceOfferingId!: string;

  @IsOptional()
  @IsEnum(PackageTier)
  packageTier?: PackageTier;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  addonIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deadlineLabel?: string;

  /** Optional override of the package price label */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  price?: string;
}

export class CreateDirectWorkRequestDto {
  @IsUUID()
  recipientUserId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  price?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deadlineLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;
}

export class RequestWorkChangesDto {
  @ValidateNested()
  @Type(() => WorkRequestTermsDto)
  proposedTerms!: WorkRequestTermsDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class WorkRequestCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ListWorkRequestsQueryDto {
  @IsIn(['sent', 'received'])
  direction!: 'sent' | 'received';

  @IsOptional()
  @IsEnum(WorkRequestStatus)
  status?: WorkRequestStatus;
}
