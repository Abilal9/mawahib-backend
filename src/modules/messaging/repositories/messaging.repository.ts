import {
  Connection,
  Conversation,
  ConversationParticipant,
  ConversationType,
  EngagementDetail,
  Message,
  MessageAttachment,
  MessageKind,
  MediaAsset,
  Prisma,
  Profile,
  User,
  EngagementReview,
  WorkEngagement,
  WorkRequest,
} from '@prisma/client';

export type ParticipantUser = User & { profile: Profile | null };

export type ConversationParticipantWithUser = ConversationParticipant & {
  user: ParticipantUser;
};

export type MessageWithAttachments = Message & {
  attachments: Array<MessageAttachment & { mediaAsset: MediaAsset }>;
  sender: ParticipantUser | null;
};

export type WorkEngagementForChat = WorkEngagement & {
  detail: EngagementDetail | null;
  workRequest: Pick<WorkRequest, 'id'> | null;
  reviews: Pick<EngagementReview, 'id' | 'reviewerId' | 'rating' | 'body' | 'createdAt' | 'staffHiddenAt'>[];
};

export type ConversationWithRelations = Conversation & {
  participants: ConversationParticipantWithUser[];
  connection: Connection | null;
  workEngagement: WorkEngagementForChat | null;
};

export interface CreateConversationInput {
  id: string;
  type: ConversationType;
  connectionId?: string | null;
  workEngagementId?: string | null;
  participantUserIds: [string, string];
}

export interface CreateMessageInput {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  clientMessageId?: string | null;
  systemPayload?: Prisma.InputJsonValue | null;
  mediaAssetIds?: string[];
}

export interface ListMessagesCursor {
  sequence: number;
}

/** Cursor for conversation image gallery: message createdAt + attachment id. */
export interface ListConversationImagesCursor {
  createdAt: Date;
  id: string;
}

export type ConversationImageAttachment = MessageAttachment & {
  mediaAsset: MediaAsset;
  message: Pick<Message, 'id' | 'createdAt'>;
};

export type ConversationListScope = 'inbox' | 'archived';

export interface MessagingRepository {
  findConversationByConnectionId(
    connectionId: string,
  ): Promise<ConversationWithRelations | null>;
  findConversationByEngagementId(
    engagementId: string,
  ): Promise<ConversationWithRelations | null>;
  findConversationById(id: string): Promise<ConversationWithRelations | null>;
  createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationWithRelations>;
  listConversationsForUser(
    userId: string,
    type?: ConversationType,
    scope?: ConversationListScope,
  ): Promise<ConversationWithRelations[]>;
  findParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ConversationParticipant | null>;
  listMessages(
    conversationId: string,
    options: { cursor?: ListMessagesCursor; limit: number },
  ): Promise<MessageWithAttachments[]>;
  /** Image attachments in a conversation (mimeType image/*), newest message first. */
  listConversationImages(
    conversationId: string,
    options: { cursor?: ListConversationImagesCursor; limit: number },
  ): Promise<ConversationImageAttachment[]>;
  /** Count of user-kind messages in a conversation (for first-message detection). */
  countUserMessages(conversationId: string): Promise<number>;
  findMessageByClientId(
    conversationId: string,
    clientMessageId: string,
  ): Promise<MessageWithAttachments | null>;
  /** Boundary lookup. Null when the id is missing or belongs to another conversation. */
  findMessageForRead(
    conversationId: string,
    messageId: string,
  ): Promise<{ id: string; sequence: number; createdAt: Date } | null>;
  findMessageSequence(
    conversationId: string,
    messageId: string,
  ): Promise<number | null>;
  /** First system message whose payload `event` matches, oldest first. */
  findSystemMessageByEvent(
    conversationId: string,
    event: string,
  ): Promise<MessageWithAttachments | null>;
  createMessage(input: CreateMessageInput): Promise<MessageWithAttachments>;
  updateConversationPreview(
    conversationId: string,
    preview: string,
    at: Date,
  ): Promise<void>;
  /**
   * Advance the read boundary to this message. A lower or equal sequence
   * changes nothing. The marker uses that row's created_at, never the
   * current time, and lastReadAt never moves backward.
   */
  markParticipantRead(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<void>;
  /** Conversation ids in the set that have an unread incoming user message. */
  unreadConversationIds(
    userId: string,
    conversationIds: string[],
  ): Promise<Set<string>>;
  /** Advance delivery watermark only (does not mark unread as read). */
  markParticipantDelivered(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void>;
  /**
   * Advance delivery for the listed conversations to the timestamps already
   * fetched for this response. A later message is not included.
   */
  markInboxDelivered(
    userId: string,
    updates: Array<{ conversationId: string; at: Date }>,
  ): Promise<void>;
  /** Read markers only, loaded immediately before receipt status is computed. */
  findParticipantWatermarks(
    conversationId: string,
  ): Promise<
    Array<{
      userId: string;
      lastDeliveredAt: Date | null;
      lastReadSequence: number | null;
    }>
  >;
  /**
   * Membership check without the conversation's profiles, work, or reviews.
   * missing: no conversation. forbidden: conversation exists, caller is absent.
   */
  findConversationAccess(
    conversationId: string,
    userId: string,
  ): Promise<'missing' | 'forbidden' | 'ok'>;
  /** Conversation-level archive (legacy / admin). Prefer per-participant archive. */
  archiveConversation(conversationId: string, at: Date): Promise<void>;
  archiveForParticipant(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void>;
  unarchiveForParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void>;
  softDeleteForParticipant(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void>;
  /** Count of inbox conversations with ≥1 unread incoming user message. */
  countUnreadForUser(userId: string): Promise<number>;
  findWorkEngagementById(
    engagementId: string,
  ): Promise<WorkEngagementForChat | null>;
  findConnectionById(connectionId: string): Promise<Connection | null>;
}

export const MESSAGING_REPOSITORY = Symbol('MESSAGING_REPOSITORY');
