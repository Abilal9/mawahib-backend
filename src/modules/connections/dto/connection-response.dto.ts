import { ConnectionRequestStatus } from '@prisma/client';
import type {
  ConnectionRequestWithUsers,
  ConnectionWithUsers,
  UserSummary,
} from '../repositories/connections.repository';

export class ConnectionUserSummaryDto {
  id!: string;
  displayName!: string;
  username!: string;
  isVerified!: boolean;
  avatarUrl!: string | null;
  title!: string | null;
}

export class ConnectionRequestResponseDto {
  id!: string;
  fromUserId!: string;
  toUserId!: string;
  status!: ConnectionRequestStatus;
  message!: string;
  createdAt!: string;
  updatedAt!: string;
  fromUser!: ConnectionUserSummaryDto;
  toUser!: ConnectionUserSummaryDto;

  static fromEntity(
    entity: ConnectionRequestWithUsers,
  ): ConnectionRequestResponseDto {
    const dto = new ConnectionRequestResponseDto();
    dto.id = entity.id;
    dto.fromUserId = entity.fromUserId;
    dto.toUserId = entity.toUserId;
    dto.status = entity.status;
    dto.message = entity.message;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    dto.fromUser = toSummary(entity.fromUser);
    dto.toUser = toSummary(entity.toUser);
    return dto;
  }
}

export class ConnectionResponseDto {
  id!: string;
  userId!: string;
  peer!: ConnectionUserSummaryDto;
  conversationId!: string | null;
  createdAt!: string;
  updatedAt!: string;

  static fromEntity(
    entity: ConnectionWithUsers,
    viewerId: string,
  ): ConnectionResponseDto {
    const dto = new ConnectionResponseDto();
    dto.id = entity.id;
    dto.userId = viewerId;
    const peer =
      entity.userLowId === viewerId ? entity.userHigh : entity.userLow;
    dto.peer = toSummary(peer);
    dto.conversationId = entity.conversation?.id ?? null;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    return dto;
  }
}

function toSummary(user: UserSummary): ConnectionUserSummaryDto {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    isVerified: user.isVerified,
    avatarUrl: user.profile?.avatarUrl ?? null,
    title: user.profile?.title ?? null,
  };
}
