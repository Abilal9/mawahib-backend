import { Injectable } from '@nestjs/common';
import { ConversationType, MessageKind, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  ConversationWithRelations,
  CreateConversationInput,
  ConversationImageAttachment,
  ConversationListScope,
  CreateMessageInput,
  ListConversationImagesCursor,
  ListMessagesCursor,
  MessagingRepository,
  MessageWithAttachments,
  WorkEngagementForChat,
} from './messaging.repository';
import type { Connection, ConversationParticipant } from '@prisma/client';

const conversationInclude = {
  participants: {
    include: { user: { include: { profile: true } } },
  },
  connection: true,
  workEngagement: {
    include: {
      detail: true,
      workRequest: { select: { id: true } },
      reviews: { select: { reviewerId: true, rating: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

const messageInclude = {
  attachments: {
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
  sender: { include: { profile: true } },
} satisfies Prisma.MessageInclude;

@Injectable()
export class PrismaMessagingRepository implements MessagingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findConversationByConnectionId(
    connectionId: string,
  ): Promise<ConversationWithRelations | null> {
    return this.prisma.conversation.findUnique({
      where: { connectionId },
      include: conversationInclude,
    });
  }

  findConversationByEngagementId(
    engagementId: string,
  ): Promise<ConversationWithRelations | null> {
    return this.prisma.conversation.findUnique({
      where: { workEngagementId: engagementId },
      include: conversationInclude,
    });
  }

  findConversationById(id: string): Promise<ConversationWithRelations | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
  }

  async createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationWithRelations> {
    return this.prisma.conversation.create({
      data: {
        id: input.id,
        type: input.type,
        connectionId: input.connectionId ?? null,
        workEngagementId: input.workEngagementId ?? null,
        participants: {
          create: input.participantUserIds.map((userId) => ({
            id: randomUUID(),
            userId,
          })),
        },
      },
      include: conversationInclude,
    });
  }

  listConversationsForUser(
    userId: string,
    type?: ConversationType,
    scope: ConversationListScope = 'inbox',
  ): Promise<ConversationWithRelations[]> {
    const participantFilter =
      scope === 'archived'
        ? { userId, deletedAt: null, archivedAt: { not: null } }
        : { userId, deletedAt: null, archivedAt: null };

    return this.prisma.conversation.findMany({
      where: {
        participants: { some: participantFilter },
        ...(type ? { type } : {}),
      },
      include: conversationInclude,
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
    });
  }

  findParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ConversationParticipant | null> {
    return this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });
  }

  listMessages(
    conversationId: string,
    options: { cursor?: ListMessagesCursor; limit: number },
  ): Promise<MessageWithAttachments[]> {
    const cursorFilter = options.cursor
      ? {
          OR: [
            { createdAt: { lt: options.cursor.createdAt } },
            {
              createdAt: options.cursor.createdAt,
              id: { lt: options.cursor.id },
            },
          ],
        }
      : {};

    return this.prisma.message.findMany({
      where: {
        conversationId,
        ...cursorFilter,
      },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit,
    });
  }

  listConversationImages(
    conversationId: string,
    options: { cursor?: ListConversationImagesCursor; limit: number },
  ): Promise<ConversationImageAttachment[]> {
    const cursorFilter = options.cursor
      ? {
          OR: [
            { message: { createdAt: { lt: options.cursor.createdAt } } },
            {
              AND: [
                { message: { createdAt: options.cursor.createdAt } },
                { id: { lt: options.cursor.id } },
              ],
            },
          ],
        }
      : {};

    return this.prisma.messageAttachment.findMany({
      where: {
        message: { conversationId },
        mediaAsset: { mimeType: { startsWith: 'image/' } },
        ...cursorFilter,
      },
      include: {
        mediaAsset: true,
        message: { select: { id: true, createdAt: true } },
      },
      orderBy: [{ message: { createdAt: 'desc' } }, { id: 'desc' }],
      take: options.limit,
    });
  }

  countUserMessages(conversationId: string): Promise<number> {
    return this.prisma.message.count({
      where: { conversationId, kind: MessageKind.user },
    });
  }

  findMessageByClientId(
    conversationId: string,
    clientMessageId: string,
  ): Promise<MessageWithAttachments | null> {
    return this.prisma.message.findUnique({
      where: {
        conversationId_clientMessageId: {
          conversationId,
          clientMessageId,
        },
      },
      include: messageInclude,
    });
  }

  async createMessage(
    input: CreateMessageInput,
  ): Promise<MessageWithAttachments> {
    const mediaAssetIds = input.mediaAssetIds ?? [];
    return this.prisma.message.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        senderId: input.senderId,
        kind: input.kind,
        body: input.body,
        clientMessageId: input.clientMessageId ?? null,
        systemPayload:
          input.systemPayload === undefined
            ? undefined
            : (input.systemPayload as Prisma.InputJsonValue),
        attachments: mediaAssetIds.length
          ? {
              create: mediaAssetIds.map((mediaAssetId, position) => ({
                id: randomUUID(),
                mediaAssetId,
                position,
              })),
            }
          : undefined,
      },
      include: messageInclude,
    });
  }

  async updateConversationPreview(
    conversationId: string,
    preview: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: at,
        lastMessagePreview: preview.slice(0, 280),
      },
    });
  }

  async markParticipantRead(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: {
        lastReadAt: at,
        // Read implies delivered.
        lastDeliveredAt: at,
      },
    });
  }

  async markParticipantDelivered(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.conversationParticipant.updateMany({
      where: {
        conversationId,
        userId,
        OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: at } }],
      },
      data: { lastDeliveredAt: at },
    });
  }

  async archiveConversation(conversationId: string, at: Date): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { archivedAt: at },
    });
  }

  async archiveForParticipant(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { archivedAt: at },
    });
  }

  async unarchiveForParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { archivedAt: null },
    });
  }

  async softDeleteForParticipant(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: {
        deletedAt: at,
        archivedAt: at,
      },
    });
  }

  /**
   * Count of non-archived, non-deleted conversations that have ≥1 unread
   * user message from someone other than `userId`.
   */
  async countUnreadForUser(userId: string): Promise<number> {
    const participations = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        archivedAt: null,
      },
      select: {
        conversationId: true,
        lastReadAt: true,
      },
    });
    if (participations.length === 0) return 0;

    let conversationsWithUnread = 0;
    for (const part of participations) {
      const firstUnread = await this.prisma.message.findFirst({
        where: {
          conversationId: part.conversationId,
          kind: MessageKind.user,
          senderId: { not: userId },
          ...(part.lastReadAt ? { createdAt: { gt: part.lastReadAt } } : {}),
        },
        select: { id: true },
      });
      if (firstUnread) conversationsWithUnread += 1;
    }
    return conversationsWithUnread;
  }

  findWorkEngagementById(
    engagementId: string,
  ): Promise<WorkEngagementForChat | null> {
    return this.prisma.workEngagement.findFirst({
      where: { id: engagementId, deletedAt: null },
      include: {
        detail: true,
        workRequest: { select: { id: true } },
        reviews: { select: { reviewerId: true, rating: true } },
      },
    });
  }

  findConnectionById(connectionId: string): Promise<Connection | null> {
    return this.prisma.connection.findUnique({ where: { id: connectionId } });
  }
}
