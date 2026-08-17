import {
  Notification,
  NotificationType,
  Prisma,
  User,
  Profile,
} from '@prisma/client';

export type NotificationWithActor = Notification & {
  actor: (User & { profile: Profile | null }) | null;
};

export interface CreateNotificationInput {
  id: string;
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  payload?: Prisma.InputJsonValue;
}

export interface NotificationRepository {
  create(input: CreateNotificationInput): Promise<NotificationWithActor>;
  listForUser(
    recipientId: string,
    options?: { take?: number; skip?: number },
  ): Promise<NotificationWithActor[]>;
  findOwnedById(
    id: string,
    recipientId: string,
  ): Promise<NotificationWithActor | null>;
  markRead(id: string, recipientId: string): Promise<NotificationWithActor>;
  markAllRead(recipientId: string): Promise<number>;
  unreadCount(recipientId: string): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
