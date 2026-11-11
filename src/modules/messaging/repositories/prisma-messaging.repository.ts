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
          staffHiddenAt: true,
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

type ConversationParticipantRow = {
  id: string;
  userId: string;
  lastReadAt: string | null;
  lastReadSequence: number | null;
  lastDeliveredAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  joinedAt: string;
  mutedAt: string | null;
  displayName: string;
  username: string;
  isVerified: boolean;
  avatarUrl: string | null;
  title: string | null;
};

type ConversationReviewRow = {
  id: string;
  reviewerId: string;
  rating: number;
  body: string;
  createdAt: string;
  staffHiddenAt: string | null;
};

type ConversationDetailRow = {
  packagePrice: string | number;
  currency: string;
  deadlineLabel: string | null;
  addons: unknown;
};

function parseJson<T>(value: T | string | null): T | null {
  if (value == null) return null;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value;
}

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

  async findConversationById(
    id: string,
  ): Promise<ConversationWithRelations | null> {
    const rows = await this.queryConversationRows(
      Prisma.sql`c.id = CAST(${id} AS uuid)`,
    );
    return rows[0] ?? null;
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
    return this.queryConversationRows(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM conversation_participants viewer
        WHERE viewer.conversation_id = c.id
          AND viewer.user_id = CAST(${userId} AS uuid)
          AND viewer.deleted_at IS NULL
          AND (
            (${scope} = 'archived' AND viewer.archived_at IS NOT NULL)
            OR (${scope} = 'inbox' AND viewer.archived_at IS NULL)
          )
      )
      AND (${type ?? null}::text IS NULL OR c.type::text = ${type ?? null})
    `);
  }

  /**
   * One query for the inbox and for opening a conversation. Reviews, price,
   * and the connection end time stay in this result so the list and the
   * chat header do not need a second work-record read.
   */
  private async queryConversationRows(
    where: Prisma.Sql,
  ): Promise<ConversationWithRelations[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        type: ConversationType;
        connection_id: string | null;
        work_engagement_id: string | null;
        archived_at: Date | null;
        last_message_at: Date | null;
        last_message_preview: string;
        last_message_sequence: number;
        created_at: Date;
        updated_at: Date;
        connection_ended_at: Date | null;
        engagement_id: string | null;
        engagement_title: string | null;
        engagement_status: string | null;
        engagement_source: string | null;
        client_id: string | null;
        provider_id: string | null;
        completed_at: Date | null;
        review_window_closes_at: Date | null;
        engagement_deleted_at: Date | null;
        due_at: Date | null;
        reviews: string | ConversationReviewRow[] | null;
        detail: string | ConversationDetailRow | null;
        work_request_id: string | null;
        participants: string | ConversationParticipantRow[];
      }>
    >`
      SELECT
        c.id,
        c.type,
        c.connection_id,
        c.work_engagement_id,
        c.archived_at,
        c.last_message_at,
        c.last_message_preview,
        c.last_message_sequence,
        c.created_at,
        c.updated_at,
        conn.ended_at AS connection_ended_at,
        we.id AS engagement_id,
        we.title AS engagement_title,
        we.status::text AS engagement_status,
        we.source::text AS engagement_source,
        we.client_id,
        we.provider_id,
        we.completed_at,
        we.review_window_closes_at,
        we.deleted_at AS engagement_deleted_at,
        we.due_at,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', r.id,
                'reviewerId', r.reviewer_id,
                'rating', r.rating,
                'body', r.body,
                'staffHiddenAt', r.staff_hidden_at,
                'createdAt', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              )
            ),
            '[]'::json
          )
          FROM engagement_reviews r
          WHERE r.engagement_id = we.id
        ) AS reviews,
        (
          SELECT json_build_object(
            'packagePrice', d.package_price,
            'currency', d.currency,
            'deadlineLabel', d.deadline_label,
            'addons', d.addons
          )
          FROM engagement_details d
          WHERE d.engagement_id = we.id
        ) AS detail,
        (
          SELECT wr.id
          FROM work_requests wr
          WHERE wr.work_engagement_id = we.id
          LIMIT 1
        ) AS work_request_id,
        json_agg(
          json_build_object(
            'id', p.id,
            'userId', p.user_id,
            'lastReadAt', to_char(p.last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'lastReadSequence', p.last_read_sequence,
            'lastDeliveredAt', to_char(p.last_delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'archivedAt', to_char(p.archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'deletedAt', to_char(p.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'joinedAt', to_char(p.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'mutedAt', to_char(p.muted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'displayName', u.display_name,
            'username', u.username,
            'isVerified', u.is_verified,
            'avatarUrl', pr.avatar_url,
            'title', pr.title
          )
        ) AS participants
      FROM conversations c
      INNER JOIN conversation_participants p ON p.conversation_id = c.id
      INNER JOIN users u ON u.id = p.user_id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      LEFT JOIN connections conn ON conn.id = c.connection_id
      LEFT JOIN work_engagements we ON we.id = c.work_engagement_id
      WHERE ${where}
      GROUP BY c.id, conn.ended_at, we.id
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
    `;
    return rows.map((row) => this.summaryToConversation(row));
  }

  private summaryToConversation(row: {
    id: string;
    type: ConversationType;
    connection_id: string | null;
    work_engagement_id: string | null;
    archived_at: Date | null;
    last_message_at: Date | null;
    last_message_preview: string;
    last_message_sequence: number;
    created_at: Date;
    updated_at: Date;
    connection_ended_at: Date | null;
    engagement_id: string | null;
    engagement_title: string | null;
    engagement_status: string | null;
    engagement_source: string | null;
    client_id: string | null;
    provider_id: string | null;
    completed_at: Date | null;
    review_window_closes_at: Date | null;
    engagement_deleted_at: Date | null;
    due_at: Date | null;
    reviews: string | ConversationReviewRow[] | null;
    detail: string | ConversationDetailRow | null;
    work_request_id: string | null;
    participants: string | ConversationParticipantRow[];
  }): ConversationWithRelations {
    const asDate = (value: string | null) => (value ? new Date(value) : null);
    const participants = parseJson(row.participants) ?? [];
    const reviews = parseJson(row.reviews) ?? [];
    const detail = parseJson(row.detail);
    return {
      id: row.id,
      type: row.type,
      connectionId: row.connection_id,
      workEngagementId: row.work_engagement_id,
      archivedAt: row.archived_at,
      lastMessageAt: row.last_message_at,
      lastMessagePreview: row.last_message_preview,
      lastMessageSequence: row.last_message_sequence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      connection: row.connection_id
        ? ({
            id: row.connection_id,
            endedAt: row.connection_ended_at,
          } as ConversationWithRelations['connection'])
        : null,
      workEngagement:
        row.engagement_id && row.engagement_status && row.engagement_source
          ? ({
              id: row.engagement_id,
              title: row.engagement_title ?? '',
              status: row.engagement_status,
              source: row.engagement_source,
              clientId: row.client_id,
              providerId: row.provider_id,
              completedAt: row.completed_at,
              reviewWindowClosesAt: row.review_window_closes_at,
              deletedAt: row.engagement_deleted_at,
              dueAt: row.due_at,
              detail: detail
                ? {
                    packagePrice: detail.packagePrice,
                    currency: String(detail.currency).trim(),
                    deadlineLabel: detail.deadlineLabel,
                    addons: detail.addons ?? [],
                  }
                : null,
              reviews: reviews.map((review) => ({
                id: review.id,
                reviewerId: review.reviewerId,
                rating: review.rating,
                body: review.body,
                createdAt: new Date(review.createdAt),
                staffHiddenAt: review.staffHiddenAt ? new Date(review.staffHiddenAt) : null,
              })),
              workRequest: row.work_request_id
                ? { id: row.work_request_id }
                : null,
            } as unknown as ConversationWithRelations['workEngagement'])
          : null,
      participants: participants.map((participant) => ({
        id: participant.id,
        conversationId: row.id,
        userId: participant.userId,
        lastReadAt: asDate(participant.lastReadAt),
        lastReadSequence: participant.lastReadSequence,
        lastDeliveredAt: asDate(participant.lastDeliveredAt),
        mutedAt: asDate(participant.mutedAt),
        archivedAt: asDate(participant.archivedAt),
        deletedAt: asDate(participant.deletedAt),
        joinedAt: new Date(participant.joinedAt),
        user: {
          id: participant.userId,
          displayName: participant.displayName,
          username: participant.username,
          isVerified: participant.isVerified,
          profile: {
            avatarUrl: participant.avatarUrl,
            title: participant.title,
          },
        },
      })),
    } as ConversationWithRelations;
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

  async listMessages(
    conversationId: string,
    options: { cursor?: ListMessagesCursor; limit: number },
  ): Promise<MessageWithAttachments[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(options.cursor
          ? { sequence: { lt: options.cursor.sequence } }
          : {}),
      },
      include: {
        attachments: {
          include: { mediaAsset: true },
          orderBy: { position: 'asc' as const },
        },
      },
      orderBy: { sequence: 'desc' },
      take: options.limit,
    });
    return rows.map((row) => ({ ...row, sender: null }));
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
          staffHiddenAt: true,
        },
      },
      },
    });
  }

  findConnectionById(connectionId: string): Promise<Connection | null> {
    return this.prisma.connection.findUnique({ where: { id: connectionId } });
  }
}
