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
  reviews: Pick<EngagementReview, 'reviewerId' | 'rating'>[];
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
  createdAt: Date;
  id: string;
}

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
  /** Count of user-kind messages in a conversation (for first-message detection). */
  countUserMessages(conversationId: string): Promise<number>;
  findMessageByClientId(
    conversationId: string,
    clientMessageId: string,
  ): Promise<MessageWithAttachments | null>;
  createMessage(input: CreateMessageInput): Promise<MessageWithAttachments>;
  updateConversationPreview(
    conversationId: string,
    preview: string,
    at: Date,
  ): Promise<void>;
  markParticipantRead(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void>;
  /** Advance delivery watermark only (does not mark unread as read). */
  markParticipantDelivered(
    conversationId: string,
    userId: string,
    at: Date,
  ): Promise<void>;
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
  countUnreadForUser(userId: string): Promise<number>;
  findWorkEngagementById(
    engagementId: string,
  ): Promise<WorkEngagementForChat | null>;
  findConnectionById(connectionId: string): Promise<Connection | null>;
}

export const MESSAGING_REPOSITORY = Symbol('MESSAGING_REPOSITORY');
