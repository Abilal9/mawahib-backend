import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  MarkAllReadResponseDto,
  NotificationPageDto,
  NotificationResponseDto,
  NotificationUnreadSummaryDto,
} from './dto/notification-response.dto';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  notificationPageSize,
} from './notification-page';
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
  ): Promise<NotificationPageDto> {
    const take = notificationPageSize(query.take);
    const cursor = decodeNotificationCursor(query.cursor);
    const rows = await this.notifications.listForUser(userId, {
      take: take + 1,
      cursor,
    });
    const page = rows.length > take ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((item) => NotificationResponseDto.fromEntity(item)),
      nextCursor:
        rows.length > take && last
          ? encodeNotificationCursor(last.createdAt, last.id)
          : null,
    };
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

  hasWorkChatStarted(
    recipientId: string,
    conversationId: string,
  ): Promise<boolean> {
    return this.notifications.hasWorkChatStarted(recipientId, conversationId);
  }
}
