import {
  ConversationType,
  MessageKind,
  WorkEngagementSource,
  WorkEngagementStatus,
} from '@prisma/client';
import type {
  ConversationWithRelations,
  MessageWithAttachments,
  ParticipantUser,
} from '../repositories/messaging.repository';
import type { MessageReceiptStatus } from '../message-receipts';

export class PeerSummaryDto {
  id!: string;
  displayName!: string;
  username!: string;
  isVerified!: boolean;
  avatarUrl!: string | null;
  title!: string | null;
}

export class WorkContextDto {
  title!: string;
  source!: WorkEngagementSource;
  status!: WorkEngagementStatus;
  price!: string | null;
  currency!: string | null;
  deadline!: string | null;
  workRequestId!: string | null;
  engagementId!: string;
  /** Viewer's own review rating when present (1–5). */
  viewerReviewRating!: number | null;
}

export class ConversationResponseDto {
  id!: string;
  type!: ConversationType;
  connectionId!: string | null;
  workEngagementId!: string | null;
  archivedAt!: string | null;
  lastMessageAt!: string | null;
  lastMessagePreview!: string;
  createdAt!: string;
  updatedAt!: string;
  peer!: PeerSummaryDto | null;
  workContext!: WorkContextDto | null;
  lastReadAt!: string | null;
  writable!: boolean;
  /** Viewer-specific archive timestamp (per-participant). */
  viewerArchivedAt!: string | null;
  /** Viewer-specific soft-delete timestamp (per-participant). */
  viewerDeletedAt!: string | null;
  viewerArchived!: boolean;

  static fromEntity(
    entity: ConversationWithRelations,
    viewerId: string,
    writable: boolean,
  ): ConversationResponseDto {
    const dto = new ConversationResponseDto();
    dto.id = entity.id;
    dto.type = entity.type;
    dto.connectionId = entity.connectionId;
    dto.workEngagementId = entity.workEngagementId;
    dto.archivedAt = entity.archivedAt?.toISOString() ?? null;
    dto.lastMessageAt = entity.lastMessageAt?.toISOString() ?? null;
    dto.lastMessagePreview = entity.lastMessagePreview;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    dto.writable = writable;

    const me = entity.participants.find((p) => p.userId === viewerId);
    dto.lastReadAt = me?.lastReadAt?.toISOString() ?? null;
    dto.viewerArchivedAt = me?.archivedAt?.toISOString() ?? null;
    dto.viewerDeletedAt = me?.deletedAt?.toISOString() ?? null;
    dto.viewerArchived = me?.archivedAt != null;

    const peer = entity.participants.find((p) => p.userId !== viewerId)?.user;
    dto.peer = peer ? toPeer(peer) : null;

    if (entity.type === ConversationType.work && entity.workEngagement) {
      const eng = entity.workEngagement;
      const myReview = eng.reviews?.find((r) => r.reviewerId === viewerId);
      dto.workContext = {
        engagementId: eng.id,
        title: eng.title,
        source: eng.source,
        status: eng.status,
        price: eng.detail ? eng.detail.packagePrice.toString() : null,
        currency: eng.detail?.currency ?? null,
        deadline: eng.detail?.deadlineLabel ?? eng.dueAt?.toISOString() ?? null,
        workRequestId: eng.workRequest?.id ?? null,
        viewerReviewRating: myReview?.rating ?? null,
      };
    } else {
      dto.workContext = null;
    }

    return dto;
  }
}

export class MessageAttachmentResponseDto {
  id!: string;
  mediaAssetId!: string;
  position!: number;
  mimeType!: string;
  url!: string | null;
  byteSize!: string | number;
  fileName!: string | null;
}

export class MessageResponseDto {
  id!: string;
  conversationId!: string;
  senderId!: string | null;
  kind!: MessageKind;
  body!: string;
  clientMessageId!: string | null;
  systemPayload!: unknown;
  createdAt!: string;
  attachments!: MessageAttachmentResponseDto[];
  sender!: PeerSummaryDto | null;
  /** Outgoing user messages only: sent | delivered | read */
  receiptStatus!: MessageReceiptStatus | null;

  static fromEntity(
    entity: MessageWithAttachments,
    receiptStatus: MessageReceiptStatus | null = null,
    attachmentExtras: Array<{
      url: string | null;
      byteSize: string | number;
      fileName: string | null;
    }> = [],
  ): MessageResponseDto {
    const dto = new MessageResponseDto();
    dto.id = entity.id;
    dto.conversationId = entity.conversationId;
    dto.senderId = entity.senderId;
    dto.kind = entity.kind;
    dto.body = entity.body;
    dto.clientMessageId = entity.clientMessageId;
    dto.systemPayload = entity.systemPayload;
    dto.createdAt = entity.createdAt.toISOString();
    dto.attachments = entity.attachments.map((a, i) => {
      const extra = attachmentExtras[i];
      return {
        id: a.id,
        mediaAssetId: a.mediaAssetId,
        position: a.position,
        mimeType: a.mediaAsset.mimeType,
        url: extra?.url ?? null,
        byteSize: extra?.byteSize ?? Number(a.mediaAsset.byteSize),
        fileName:
          extra?.fileName ?? fileNameFromObjectKey(a.mediaAsset.objectKey),
      };
    });
    dto.sender = entity.sender ? toPeer(entity.sender) : null;
    dto.receiptStatus = receiptStatus;
    return dto;
  }
}

export class MessagesPageDto {
  items!: MessageResponseDto[];
  nextCursor!: string | null;
}

export class ConversationUnreadSummaryDto {
  unreadCount!: number;
}

function toPeer(user: ParticipantUser): PeerSummaryDto {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    isVerified: user.isVerified,
    avatarUrl: user.profile?.avatarUrl ?? null,
    title: user.profile?.title ?? null,
  };
}

function fileNameFromObjectKey(objectKey: string): string | null {
  const segment = objectKey.split('/').pop();
  return segment && segment.length > 0 ? segment : null;
}
