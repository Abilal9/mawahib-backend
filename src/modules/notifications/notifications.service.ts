import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  MarkAllReadResponseDto,
  NotificationResponseDto,
  NotificationUnreadSummaryDto,
} from './dto/notification-response.dto';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from './repositories/notification.repository';

export interface CreateNotificationParams {
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notifications: NotificationRepository,
  ) {}

  async createNotification(
    params: CreateNotificationParams,
  ): Promise<NotificationResponseDto> {
    const created = await this.notifications.create({
      id: randomUUID(),
      recipientId: params.recipientId,
      actorId: params.actorId ?? null,
      type: params.type,
      title: params.title,
      body: params.body ?? '',
      payload: params.payload,
    });
    return NotificationResponseDto.fromEntity(created);
  }

  async listForUser(
    userId: string,
    query: ListNotificationsQueryDto = {},
  ): Promise<NotificationResponseDto[]> {
    const items = await this.notifications.listForUser(userId, {
      take: query.take,
      skip: query.skip,
    });
    return items.map((item) => NotificationResponseDto.fromEntity(item));
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationResponseDto> {
    const existing = await this.notifications.findOwnedById(
      notificationId,
      userId,
    );
    if (!existing) throw new NotFoundException('Notification not found');
    if (existing.readAt) {
      return NotificationResponseDto.fromEntity(existing);
    }
    const updated = await this.notifications.markRead(notificationId, userId);
    return NotificationResponseDto.fromEntity(updated);
  }

  async markAllRead(userId: string): Promise<MarkAllReadResponseDto> {
    const updatedCount = await this.notifications.markAllRead(userId);
    return { updatedCount };
  }

  async unreadCount(userId: string): Promise<NotificationUnreadSummaryDto> {
    const unreadCount = await this.notifications.unreadCount(userId);
    return { unreadCount };
  }
}
