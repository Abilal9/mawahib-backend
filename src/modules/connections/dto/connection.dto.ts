import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateConnectionRequestDto {
  @IsUUID()
  toUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export enum ConnectionRequestDirection {
  incoming = 'incoming',
  outgoing = 'outgoing',
  all = 'all',
}

export class ListConnectionRequestsQueryDto {
  @IsOptional()
  @IsEnum(ConnectionRequestDirection)
  @Type(() => String)
  direction?: ConnectionRequestDirection;
}
