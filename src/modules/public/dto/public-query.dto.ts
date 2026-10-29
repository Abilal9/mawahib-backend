import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PUBLIC_DEFAULT_TAKE,
  PUBLIC_MAX_SKIP,
  PUBLIC_MAX_TAKE,
  PUBLIC_Q_MAX_LENGTH,
  PUBLIC_Q_MIN_LENGTH,
} from '../public.constants';

function trimToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class PublicFeedQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_MAX_TAKE)
  take?: number = PUBLIC_DEFAULT_TAKE;
}

export class PublicListQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_MAX_TAKE)
  take?: number = PUBLIC_DEFAULT_TAKE;
}

export class PublicSearchQueryDto {
  @IsOptional()
  @Transform(({ value }) => trimToUndefined(value))
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(PUBLIC_Q_MIN_LENGTH)
  @MaxLength(PUBLIC_Q_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(PUBLIC_MAX_SKIP)
  skip?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_MAX_TAKE)
  take?: number = PUBLIC_DEFAULT_TAKE;
}
