import { MediaPurpose } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUploadSessionDto {
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  byteSize!: number;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  fileName?: string;
}
