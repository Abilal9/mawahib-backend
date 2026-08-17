import { NotificationType } from '@prisma/client';
import type { NotificationWithActor } from '../repositories/notification.repository';

export class NotificationActorSummaryDto {
  id!: string;
  displayName!: string;
  username!: string;
  avatarUrl!: string | null;
}

export class NotificationResponseDto {
  id!: string;
  type!: NotificationType;
  title!: string;
  body!: string;
  payload!: unknown;
  readAt!: string | null;
  createdAt!: string;
  actor!: NotificationActorSummaryDto | null;

  static fromEntity(entity: NotificationWithActor): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = entity.id;
    dto.type = entity.type;
    dto.title = entity.title;
    dto.body = entity.body;
    dto.payload = entity.payload;
    dto.readAt = entity.readAt?.toISOString() ?? null;
    dto.createdAt = entity.createdAt.toISOString();
    dto.actor = entity.actor
      ? {
          id: entity.actor.id,
          displayName: entity.actor.displayName,
          username: entity.actor.username,
          avatarUrl: entity.actor.profile?.avatarUrl ?? null,
        }
      : null;
    return dto;
  }
}

export class NotificationUnreadSummaryDto {
  unreadCount!: number;
}

export class MarkAllReadResponseDto {
  updatedCount!: number;
}
