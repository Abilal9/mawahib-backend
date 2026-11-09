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
      reviews: {
        select: {
          id: true,
          reviewerId: true,
          rating: true,
          body: true,
          createdAt: true,
        },
      },
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
    return this.prisma.message.findMany({
      where: {
        conversationId,
        ...(options.cursor
          ? { sequence: { lt: options.cursor.sequence } }
          : {}),
      },
      include: messageInclude,
      orderBy: { sequence: 'desc' },
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

  findSystemMessageByEvent(
    conversationId: string,
    event: string,
  ): Promise<MessageWithAttachments | null> {
    return this.prisma.message.findFirst({
      where: {
        conversationId,
        kind: MessageKind.system,
        systemPayload: {
          path: ['event'],
          equals: event,
        },
      },
      include: messageInclude,
      orderBy: { createdAt: 'asc' },
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

  findMessageForRead(
    conversationId: string,
    messageId: string,
  ): Promise<{ id: string; sequence: number; createdAt: Date } | null> {
    return this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, sequence: true, createdAt: true },
    });
  }

  async findMessageSequence(
    conversationId: string,
    messageId: string,
  ): Promise<number | null> {
    const message = await this.findMessageForRead(conversationId, messageId);
    return message?.sequence ?? null;
  }

  async markParticipantRead(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE conversation_participants AS cp
      SET
        last_read_sequence = boundary.sequence,
        last_read_at = GREATEST(cp.last_read_at, boundary.created_at),
        last_delivered_at = GREATEST(cp.last_delivered_at, boundary.created_at)
      FROM messages AS boundary
      WHERE boundary.id = CAST(${messageId} AS uuid)
        AND boundary.conversation_id = CAST(${conversationId} AS uuid)
        AND cp.conversation_id = boundary.conversation_id
        AND cp.user_id = CAST(${userId} AS uuid)
        AND (
          cp.last_read_sequence IS NULL
          OR cp.last_read_sequence < boundary.sequence
        )
    `;
  }

  async unreadConversationIds(
    userId: string,
    conversationIds: string[],
  ): Promise<Set<string>> {
    if (conversationIds.length === 0) return new Set();
    const ids = Prisma.join(
      conversationIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`),
    );
    const rows = await this.prisma.$queryRaw<Array<{ conversation_id: string }>>`
      SELECT DISTINCT m.conversation_id
      FROM messages m
      INNER JOIN conversation_participants cp
        ON cp.conversation_id = m.conversation_id
       AND cp.user_id = CAST(${userId} AS uuid)
      WHERE m.conversation_id IN (${ids})
        AND m.kind = 'user'
        AND m.sender_id IS NOT NULL
        AND m.sender_id <> CAST(${userId} AS uuid)
        AND (
          cp.last_read_sequence IS NULL
          OR m.sequence > cp.last_read_sequence
        )
    `;
    return new Set(rows.map((row) => row.conversation_id));
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

  async markInboxDelivered(
    userId: string,
    updates: Array<{ conversationId: string; at: Date }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    const rows = Prisma.join(
      updates.map(
        (update) =>
          Prisma.sql`(CAST(${update.conversationId} AS uuid), CAST(${update.at} AS timestamp(3)))`,
      ),
    );
    await this.prisma.$executeRaw`
      UPDATE conversation_participants AS cp
      SET last_delivered_at = src.at
      FROM (VALUES ${rows}) AS src(conversation_id, at)
      WHERE cp.user_id = CAST(${userId} AS uuid)
        AND cp.conversation_id = src.conversation_id
        AND (
          cp.last_delivered_at IS NULL
          OR cp.last_delivered_at < src.at
        )
    `;
  }

  findParticipantWatermarks(conversationId: string): Promise<
    Array<{
      userId: string;
      lastDeliveredAt: Date | null;
      lastReadSequence: number | null;
    }>
  > {
    return this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: {
        userId: true,
        lastDeliveredAt: true,
        lastReadSequence: true,
      },
    });
  }

  async findConversationAccess(
    conversationId: string,
    userId: string,
  ): Promise<'missing' | 'forbidden' | 'ok'> {
    const rows = await this.prisma.$queryRaw<Array<{ member: boolean }>>`
      SELECT (p.user_id IS NOT NULL) AS member
      FROM conversations c
      LEFT JOIN conversation_participants p
        ON p.conversation_id = c.id
       AND p.user_id = CAST(${userId} AS uuid)
      WHERE c.id = CAST(${conversationId} AS uuid)
    `;
    if (rows.length === 0) return 'missing';
    return rows[0]?.member ? 'ok' : 'forbidden';
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
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM conversation_participants cp
      WHERE cp.user_id = CAST(${userId} AS uuid)
        AND cp.deleted_at IS NULL
        AND cp.archived_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM messages m
          WHERE m.conversation_id = cp.conversation_id
            AND m.kind = 'user'
            AND m.sender_id IS NOT NULL
            AND m.sender_id <> cp.user_id
            AND (
              cp.last_read_sequence IS NULL
              OR m.sequence > cp.last_read_sequence
            )
        )
    `;
    return Number(rows[0]?.count ?? 0);
  }

  findWorkEngagementById(
    engagementId: string,
  ): Promise<WorkEngagementForChat | null> {
    return this.prisma.workEngagement.findFirst({
      where: { id: engagementId, deletedAt: null },
      include: {
        detail: true,
        workRequest: { select: { id: true } },
        reviews: {
        select: {
          id: true,
          reviewerId: true,
          rating: true,
          body: true,
          createdAt: true,
        },
      },
      },
    });
  }

  findConnectionById(connectionId: string): Promise<Connection | null> {
    return this.prisma.connection.findUnique({ where: { id: connectionId } });
  }
}
