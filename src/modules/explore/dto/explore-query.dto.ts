import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ExploreIdQuery } from '../../taxonomy/explore-taxonomy-filter';

export const EXPLORE_DEFAULT_TAKE = 20;
export const EXPLORE_MAX_TAKE = 50;

export class ExploreTalentQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  locationCode?: string;

  @IsOptional()
  @IsIn(['recommended', 'top-rated'])
  sort?: 'recommended' | 'top-rated';

  @ExploreIdQuery()
  categoryIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPLORE_MAX_TAKE)
  take?: number;
}

export class ExploreServiceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  locationCode?: string;

  @IsOptional()
  @IsIn(['newest'])
  sort?: 'newest';

  @ExploreIdQuery()
  categoryIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPLORE_MAX_TAKE)
  take?: number;
}
