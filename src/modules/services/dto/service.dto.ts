import { PackageTier } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ServiceMediaItemDto {
  @IsUUID()
  mediaAssetId!: string;
}

export class ServicePackageDto {
  @IsEnum(PackageTier)
  tier!: PackageTier;

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  price!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/)
  deliveryLabel!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  includes!: string[];
}

export class ServiceAddonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/)
  title!: string;

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  price!: number;
}

export class CreateServiceOfferingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsUUID()
  categoryId!: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(200)
  customCategory?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  skillIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ServiceMediaItemDto)
  media!: ServiceMediaItemDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ServicePackageDto)
  packages!: ServicePackageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceAddonDto)
  addons?: ServiceAddonDto[];
}

export class UpdateServiceOfferingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(200)
  customCategory?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  skillIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ServiceMediaItemDto)
  media?: ServiceMediaItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ServicePackageDto)
  packages?: ServicePackageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceAddonDto)
  addons?: ServiceAddonDto[];
}

export class ReorderServicesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds!: string[];
}
