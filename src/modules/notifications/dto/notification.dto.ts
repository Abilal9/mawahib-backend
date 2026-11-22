import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '../notification-category';

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  /** Absent means every category. */
  @IsOptional()
  @IsString()
  @IsIn(NOTIFICATION_CATEGORIES)
  category?: NotificationCategory;
}
