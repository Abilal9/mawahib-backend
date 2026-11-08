import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { notificationKeyset, type NotificationCursor } from '../notification-page';
import {
  CreateNotificationInput,
  NotificationRepository,
  NotificationWithActor,
} from './notification.repository';

const actorInclude = {
  actor: { include: { profile: true } },
} as const;

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotificationInput): Promise<NotificationWithActor> {
    return this.prisma.notification.create({
      data: {
        id: input.id,
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        payload: input.payload ?? {},
      },
      include: actorInclude,
    });
  }

  listForUser(
    recipientId: string,
    options: { take: number; cursor: NotificationCursor | null },
  ): Promise<NotificationWithActor[]> {
    return this.prisma.notification.findMany({
      where: {
        recipientId,
        ...notificationKeyset(options.cursor),
      },
      include: actorInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take,
    });
  }

  findOwnedById(
    id: string,
    recipientId: string,
  ): Promise<NotificationWithActor | null> {
    return this.prisma.notification.findFirst({
      where: { id, recipientId },
      include: actorInclude,
    });
  }

  async markRead(
    id: string,
    recipientId: string,
  ): Promise<NotificationWithActor> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientId },
      data: { readAt: new Date() },
    });
    if (result.count !== 1) {
      throw new Error('Notification not found');
    }
    const updated = await this.prisma.notification.findFirst({
      where: { id, recipientId },
      include: actorInclude,
    });
    if (!updated) throw new Error('Notification not found');
    return updated;
  }

  async markAllRead(recipientId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  unreadCount(recipientId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId, readAt: null },
    });
  }

  async hasWorkChatStarted(
    recipientId: string,
    conversationId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        recipientId,
        AND: [
          {
            payload: {
              path: ['params', 'event'],
              equals: 'work_chat_started',
            },
          },
          {
            payload: {
              path: ['params', 'conversationId'],
              equals: conversationId,
            },
          },
        ],
      },
      select: { id: true },
    });
    return existing != null;
  }
}
