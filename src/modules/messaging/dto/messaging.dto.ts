import { ConversationType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
} from 'class-validator';
import { MESSAGE_BODY_MAX_LENGTH } from '../message-receipts';

export class ListConversationsQueryDto {
  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType;

  @IsOptional()
  @IsIn(['inbox', 'archived'])
  scope?: 'inbox' | 'archived';
}

export class ListMessagesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(MESSAGE_BODY_MAX_LENGTH)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  mediaAssetIds?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  clientMessageId?: string;
}
