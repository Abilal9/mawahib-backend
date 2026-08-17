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
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DEADLINE_TYPES,
  DURATION_UNITS,
  type DeadlineType,
  type DurationUnit,
  validateDeadline,
} from '../work-request-terms';

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

export class CreateEngagementReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;
}

const ISO_DATE_MESSAGE = 'must be an ISO date (YYYY-MM-DD)';

/** Cross-field deadline rules live in one place — see `validateDeadline`. */
@ValidatorConstraint({ name: 'workRequestDeadline', async: false })
export class DeadlineShapeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return validateDeadline(args.object).length === 0;
  }

  defaultMessage(args: ValidationArguments): string {
    return validateDeadline(args.object).join('; ');
  }
}

/** Structured amount + currency. Currency defaults to SAR when omitted. */
export class WorkRequestMoneyDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

/** Structured deadline: an exact date, a range, a duration, or flexible. */
export class WorkRequestDeadlineDto {
  @IsIn(DEADLINE_TYPES as readonly string[])
  @Validate(DeadlineShapeConstraint)
  type!: DeadlineType;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: `startDate ${ISO_DATE_MESSAGE}` })
  startDate?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: `endDate ${ISO_DATE_MESSAGE}` })
  endDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationValue?: number | null;

  @IsOptional()
  @IsIn(DURATION_UNITS as readonly string[])
  durationUnit?: DurationUnit | null;
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

  /** `null` clears the agreed amount; a partial object patches it. */
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkRequestMoneyDto)
  money?: WorkRequestMoneyDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkRequestDeadlineDto)
  deadline?: WorkRequestDeadlineDto;

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

  /** Optional override of the package price */
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkRequestMoneyDto)
  money?: WorkRequestMoneyDto;

  /** Optional override of the package delivery time */
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkRequestDeadlineDto)
  deadline?: WorkRequestDeadlineDto;

  /** @deprecated free-text fallback — send `money` / `deadline` instead */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  price?: string;

  /** @deprecated free-text fallback — send `deadline` instead */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deadlineLabel?: string;
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
  @ValidateNested()
  @Type(() => WorkRequestMoneyDto)
  money?: WorkRequestMoneyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkRequestDeadlineDto)
  deadline?: WorkRequestDeadlineDto;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  /** @deprecated free-text fallback — send `money` instead */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  price?: string;

  /** @deprecated free-text fallback — send `money.currency` instead */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  /** @deprecated free-text fallback — send `deadline` instead */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deadlineLabel?: string;
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
