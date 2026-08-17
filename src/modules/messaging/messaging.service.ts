import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationType,
  MediaPurpose,
  MessageKind,
  NotificationType,
  WorkEngagementStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ConversationMediaPageDto,
  ConversationResponseDto,
  ConversationUnreadSummaryDto,
  MessageResponseDto,
  MessagesPageDto,
} from './dto/messaging-response.dto';
import {
  ListConversationMediaQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/messaging.dto';
import {
  MESSAGE_BODY_MAX_LENGTH,
  computeMessageReceiptStatus,
} from './message-receipts';
import {
  MESSAGING_REPOSITORY,
  type ConversationWithRelations,
  type MessageWithAttachments,
  type MessagingRepository,
} from './repositories/messaging.repository';

const WRITABLE_WORK_STATUSES: WorkEngagementStatus[] = [
  WorkEngagementStatus.in_progress,
  WorkEngagementStatus.delivered,
];

/**
 * Writable rules:
 * - conversation.archivedAt (legacy conversation-level) still blocks
 * - connection ended → read-only
 * - work engagement completed/cancelled (not in WRITABLE_WORK_STATUSES) → read-only
 * Per-participant archivedAt does NOT block writing by itself (inbox hide only).
 */
export function isConversationWritable(
  conversation: ConversationWithRelations,
): boolean {
  if (conversation.archivedAt) return false;

  if (conversation.type === ConversationType.connection) {
    return conversation.connection?.endedAt == null;
  }

  if (conversation.type === ConversationType.work) {
    const status = conversation.workEngagement?.status;
    if (!status) return false;
    return WRITABLE_WORK_STATUSES.includes(status);
  }

  return false;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { createdAt?: string; id?: string };
    if (!raw.createdAt || !raw.id) return null;
    const createdAt = new Date(raw.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: raw.id };
  } catch {
    return null;
  }
}

function fileNameFromObjectKey(objectKey: string): string | null {
  const segment = objectKey.split('/').pop();
  return segment && segment.length > 0 ? segment : null;
}

@Injectable()
export class MessagingService {
  constructor(
    @Inject(MESSAGING_REPOSITORY)
    private readonly messaging: MessagingRepository,
    private readonly notifications: NotificationsService,
    private readonly mediaService: MediaService,
  ) {}

  async ensureConnectionConversation(
    connectionId: string,
    userA: string,
    userB: string,
  ): Promise<ConversationWithRelations> {
    const existing =
      await this.messaging.findConversationByConnectionId(connectionId);
    if (existing) return existing;

    return this.messaging.createConversation({
      id: randomUUID(),
      type: ConversationType.connection,
      connectionId,
      participantUserIds: [userA, userB],
    });
  }

  async ensureWorkConversation(
    engagementId: string,
    clientId: string,
    providerId: string,
  ): Promise<ConversationWithRelations> {
    const existing =
      await this.messaging.findConversationByEngagementId(engagementId);
    if (existing) return existing;

    return this.messaging.createConversation({
      id: randomUUID(),
      type: ConversationType.work,
      workEngagementId: engagementId,
      participantUserIds: [clientId, providerId],
    });
  }

  /**
   * Called when an engagement enters in_progress (payment settled / Phase 5,
   * or DEV-ONLY start-work). Creates the work conversation and a system message.
   * Emits one in-app notification per participant that the work chat is available
   * (not per subsequent message).
   */
  async onEngagementBecameInProgress(
    engagementId: string,
    clientId: string,
    providerId: string,
  ): Promise<ConversationWithRelations> {
    const existing =
      await this.messaging.findConversationByEngagementId(engagementId);
    const conversation = existing
      ? existing
      : await this.messaging.createConversation({
          id: randomUUID(),
          type: ConversationType.work,
          workEngagementId: engagementId,
          participantUserIds: [clientId, providerId],
        });
    const isNew = !existing;

    const body = 'Work started';
    const message = await this.messaging.createMessage({
      id: randomUUID(),
      conversationId: conversation.id,
      senderId: null,
      kind: MessageKind.system,
      body,
      systemPayload: {
        event: 'engagement_in_progress',
        engagementId,
        projection: 'payment_completed',
      },
    });
    await this.messaging.updateConversationPreview(
      conversation.id,
      body,
      message.createdAt,
    );

    const fresh =
      (await this.messaging.findConversationById(conversation.id)) ??
      conversation;

    if (isNew) {
      const jobTitle = fresh.workEngagement?.title ?? null;
      for (const participant of fresh.participants) {
        const peer = fresh.participants.find(
          (p) => p.userId !== participant.userId,
        );
        const peerName = peer?.user?.displayName?.trim() || 'the other party';
        await this.notifications.createNotification({
          recipientId: participant.userId,
          actorId: peer?.userId ?? null,
          type: NotificationType.message_received,
          title: peerName,
          body: 'A work chat has started',
          payload: {
            screen: 'conversation',
            params: {
              conversationId: fresh.id,
              event: 'work_chat_started',
              engagementId,
              ...(jobTitle ? { jobTitle } : {}),
            },
          },
        });
      }
    }

    return fresh;
  }

  async onEngagementStatusChanged(
    engagementId: string,
    toStatus: WorkEngagementStatus,
  ): Promise<void> {
    const conversation =
      await this.messaging.findConversationByEngagementId(engagementId);
    if (!conversation) return;

    let body: string | null = null;
    if (toStatus === WorkEngagementStatus.delivered) {
      body = 'Work delivered';
    } else if (toStatus === WorkEngagementStatus.completed) {
      body = 'Work completed';
    }

    if (body) {
      const message = await this.messaging.createMessage({
        id: randomUUID(),
        conversationId: conversation.id,
        senderId: null,
        kind: MessageKind.system,
        body,
        systemPayload: {
          event: 'engagement_status',
          engagementId,
          toStatus,
        },
      });
      await this.messaging.updateConversationPreview(
        conversation.id,
        body,
        message.createdAt,
      );
    }

    // Completed chats stay in inbox (read-only) until the user rates.
    // Per-participant archive happens via EngagementReview → archiveConversationForMe.
  }

  async listMyConversations(
    userId: string,
    query: ListConversationsQueryDto = {},
  ): Promise<ConversationResponseDto[]> {
    const scope = query.scope ?? 'inbox';
    const items = await this.messaging.listConversationsForUser(
      userId,
      query.type,
      scope,
    );

    // Inbox load = delivered to recipient (no extra poll; uses existing inbox poll).
    await Promise.all(
      items.map(async (item) => {
        if (!item.lastMessageAt) return;
        await this.messaging.markParticipantDelivered(
          item.id,
          userId,
          item.lastMessageAt,
        );
      }),
    );

    return items.map((item) =>
      ConversationResponseDto.fromEntity(
        item,
        userId,
        isConversationWritable(item),
      ),
    );
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.requireParticipant(userId, conversationId);
    // Refresh work engagement for current status / price context.
    if (
      conversation.type === ConversationType.work &&
      conversation.workEngagementId
    ) {
      const engagement = await this.messaging.findWorkEngagementById(
        conversation.workEngagementId,
      );
      if (engagement) {
        conversation.workEngagement = engagement;
      }
    }
    if (
      conversation.type === ConversationType.connection &&
      conversation.connectionId
    ) {
      const connection = await this.messaging.findConnectionById(
        conversation.connectionId,
      );
      if (connection) conversation.connection = connection;
    }

    return ConversationResponseDto.fromEntity(
      conversation,
      userId,
      isConversationWritable(conversation),
    );
  }

  async listMessages(
    userId: string,
    conversationId: string,
    query: ListMessagesQueryDto = {},
  ): Promise<MessagesPageDto> {
    const conversation = await this.requireParticipant(userId, conversationId);
    const limit = query.limit ?? 30;
    let cursor: { createdAt: Date; id: string } | undefined;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded) throw new BadRequestException('Invalid cursor');
      cursor = decoded;
    }

    const items = await this.messaging.listMessages(conversationId, {
      cursor,
      limit: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    // Thread fetch advances delivery for incoming messages only
    // (existing chat poll — no separate receipt poll).
    const newestIncoming = page
      .filter(
        (m) =>
          m.kind === MessageKind.user &&
          m.senderId != null &&
          m.senderId !== userId,
      )
      .reduce<Date | null>((acc, m) => {
        if (!acc || m.createdAt > acc) return m.createdAt;
        return acc;
      }, null);
    if (newestIncoming) {
      await this.messaging.markParticipantDelivered(
        conversationId,
        userId,
        newestIncoming,
      );
    }

    // Fresh peer watermarks for receipt status (Sent → Delivered → Read).
    const fresh = await this.messaging.findConversationById(conversationId);
    const peer = (fresh ?? conversation).participants.find(
      (p) => p.userId !== userId,
    );
    const mapped = await Promise.all(
      page.map((m) =>
        this.toMessageDto(m, userId, peer?.lastDeliveredAt, peer?.lastReadAt),
      ),
    );
    return {
      items: mapped,
      nextCursor:
        hasMore && page[page.length - 1]
          ? encodeCursor(
              page[page.length - 1].createdAt,
              page[page.length - 1].id,
            )
          : null,
    };
  }

  async listConversationMedia(
    userId: string,
    conversationId: string,
    query: ListConversationMediaQueryDto = {},
  ): Promise<ConversationMediaPageDto> {
    await this.requireParticipant(userId, conversationId);
    const limit = query.limit ?? 40;
    let cursor: { createdAt: Date; id: string } | undefined;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded) throw new BadRequestException('Invalid cursor');
      cursor = decoded;
    }

    const items = await this.messaging.listConversationImages(conversationId, {
      cursor,
      limit: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const mapped = await Promise.all(
      page.map(async (a) => {
        const url = await this.mediaService.getSignedUrlForAsset(
          a.mediaAssetId,
        );
        return {
          id: a.id,
          mediaAssetId: a.mediaAssetId,
          messageId: a.messageId,
          url,
          mimeType: a.mediaAsset.mimeType,
          createdAt: a.message.createdAt.toISOString(),
        };
      }),
    );

    const last = page[page.length - 1];
    return {
      items: mapped,
      nextCursor:
        hasMore && last ? encodeCursor(last.message.createdAt, last.id) : null,
    };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const conversation = await this.requireParticipant(userId, conversationId);

    if (!isConversationWritable(conversation)) {
      throw new ForbiddenException('Conversation is read-only');
    }

    // Work chat must not be usable before in_progress.
    if (
      conversation.type === ConversationType.work &&
      conversation.workEngagement &&
      !WRITABLE_WORK_STATUSES.includes(conversation.workEngagement.status)
    ) {
      throw new ForbiddenException(
        'Work chat is only available after work has started',
      );
    }

    const body = dto.body?.trim() ?? '';
    const mediaAssetIds = dto.mediaAssetIds ?? [];
    if (!body && mediaAssetIds.length === 0) {
      throw new BadRequestException('body or mediaAssetIds is required');
    }
    if (body.length > MESSAGE_BODY_MAX_LENGTH) {
      throw new BadRequestException(
        `Message is too long (max ${MESSAGE_BODY_MAX_LENGTH} characters)`,
      );
    }

    if (dto.clientMessageId) {
      const existing = await this.messaging.findMessageByClientId(
        conversationId,
        dto.clientMessageId,
      );
      if (existing) {
        return this.toMessageDtoForViewer(existing, userId, conversation);
      }
    }

    if (mediaAssetIds.length > 0) {
      const assets = await this.mediaService.requireReadyOwnedAssets(
        userId,
        mediaAssetIds,
      );
      if (assets.some((a) => a.purpose !== MediaPurpose.message)) {
        throw new BadRequestException(
          'All attachments must be ready media assets with purpose=message',
        );
      }
    }

    try {
      const message = await this.messaging.createMessage({
        id: randomUUID(),
        conversationId,
        senderId: userId,
        kind: MessageKind.user,
        body,
        clientMessageId: dto.clientMessageId ?? null,
        mediaAssetIds,
      });
      await this.messaging.updateConversationPreview(
        conversationId,
        body || '[attachment]',
        message.createdAt,
      );

      // In-app Notifications announce NEW conversations only — not every message.
      // Work chats notify on in_progress creation; connection chats notify on
      // the first user message. Unread badges / inbox order handle the rest.
      if (conversation.type === ConversationType.connection) {
        const peerId = conversation.participants.find(
          (p) => p.userId !== userId,
        )?.userId;
        if (peerId) {
          const userMessageCount =
            await this.messaging.countUserMessages(conversationId);
          const isFirstMessage = userMessageCount <= 1;
          if (isFirstMessage) {
            const senderName =
              conversation.participants.find((p) => p.userId === userId)?.user
                ?.displayName ?? 'Someone';
            await this.notifications.createNotification({
              recipientId: peerId,
              actorId: userId,
              type: NotificationType.message_received,
              title: senderName,
              body: 'started a conversation with you',
              payload: {
                screen: 'conversation',
                params: {
                  conversationId,
                  event: 'conversation_started',
                },
              },
            });
          }
        }
      }

      return this.toMessageDtoForViewer(message, userId, conversation);
    } catch (err: unknown) {
      // Idempotent retry race: unique (conversationId, clientMessageId).
      if (
        dto.clientMessageId &&
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        const existing = await this.messaging.findMessageByClientId(
          conversationId,
          dto.clientMessageId,
        );
        if (existing) {
          return this.toMessageDtoForViewer(existing, userId, conversation);
        }
      }
      throw err;
    }
  }

  async markRead(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponseDto> {
    await this.requireParticipant(userId, conversationId);
    await this.messaging.markParticipantRead(
      conversationId,
      userId,
      new Date(),
    );
    return this.getConversation(userId, conversationId);
  }

  async archiveConversationForMe(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponseDto> {
    await this.requireParticipant(userId, conversationId);
    await this.messaging.archiveForParticipant(
      conversationId,
      userId,
      new Date(),
    );
    return this.getConversation(userId, conversationId);
  }

  async unarchiveConversationForMe(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponseDto> {
    await this.requireParticipant(userId, conversationId);
    await this.messaging.unarchiveForParticipant(conversationId, userId);
    return this.getConversation(userId, conversationId);
  }

  async deleteConversationForMe(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.requireParticipant(userId, conversationId);
    await this.messaging.softDeleteForParticipant(
      conversationId,
      userId,
      new Date(),
    );
  }

  /**
   * After a party submits an engagement review, archive the work chat for them.
   * Returns conversationId when a work conversation exists.
   */
  async archiveWorkConversationForReviewer(
    userId: string,
    engagementId: string,
  ): Promise<string | null> {
    const conversation =
      await this.messaging.findConversationByEngagementId(engagementId);
    if (!conversation) return null;
    const isParticipant = conversation.participants.some(
      (p) => p.userId === userId,
    );
    if (!isParticipant) return conversation.id;
    await this.messaging.archiveForParticipant(
      conversation.id,
      userId,
      new Date(),
    );
    return conversation.id;
  }

  async getUnreadSummary(
    userId: string,
  ): Promise<ConversationUnreadSummaryDto> {
    const unreadCount = await this.messaging.countUnreadForUser(userId);
    return { unreadCount };
  }

  private async toMessageDtoForViewer(
    message: MessageWithAttachments,
    viewerId: string,
    conversation: ConversationWithRelations,
  ): Promise<MessageResponseDto> {
    const peer = conversation.participants.find((p) => p.userId !== viewerId);
    return this.toMessageDto(
      message,
      viewerId,
      peer?.lastDeliveredAt,
      peer?.lastReadAt,
    );
  }

  private async toMessageDto(
    message: MessageWithAttachments,
    viewerId: string,
    peerLastDeliveredAt: Date | null | undefined,
    peerLastReadAt: Date | null | undefined,
  ): Promise<MessageResponseDto> {
    const receiptStatus = computeMessageReceiptStatus({
      kind: message.kind,
      senderId: message.senderId,
      createdAt: message.createdAt,
      viewerId,
      peerLastDeliveredAt,
      peerLastReadAt,
    });
    const attachmentExtras = await Promise.all(
      message.attachments.map(async (a) => {
        const url = await this.mediaService.getSignedUrlForAsset(
          a.mediaAssetId,
        );
        return {
          url,
          byteSize: Number(a.mediaAsset.byteSize),
          fileName: fileNameFromObjectKey(a.mediaAsset.objectKey),
        };
      }),
    );
    return MessageResponseDto.fromEntity(
      message,
      receiptStatus,
      attachmentExtras,
    );
  }

  private async requireParticipant(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithRelations> {
    const conversation =
      await this.messaging.findConversationById(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    const isParticipant = conversation.participants.some(
      (p) => p.userId === userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant');
    }
    return conversation;
  }
}
