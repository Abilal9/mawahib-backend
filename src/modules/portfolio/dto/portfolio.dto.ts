import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PortfolioMediaItemDto {
  @IsUUID()
  mediaAssetId!: string;
}

export class CreatePortfolioProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PortfolioMediaItemDto)
  media!: PortfolioMediaItemDto[];
}

export class UpdatePortfolioProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PortfolioMediaItemDto)
  media?: PortfolioMediaItemDto[];
}

export class ReorderPortfolioDto {
  @IsArray()
  @IsUUID('4', { each: true })
  projectIds!: string[];
}
