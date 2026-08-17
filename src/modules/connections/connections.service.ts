import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionRequestStatus, NotificationType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../users/repositories/user.repository';
import {
  ConnectionRequestResponseDto,
  ConnectionResponseDto,
} from './dto/connection-response.dto';
import {
  ConnectionRequestDirection,
  CreateConnectionRequestDto,
  ListConnectionRequestsQueryDto,
} from './dto/connection.dto';
import {
  CONNECTIONS_REPOSITORY,
  orderedPair,
  type ConnectionsRepository,
} from './repositories/connections.repository';

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(CONNECTIONS_REPOSITORY)
    private readonly connections: ConnectionsRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
  ) {}

  async createRequest(
    fromUserId: string,
    dto: CreateConnectionRequestDto,
  ): Promise<ConnectionRequestResponseDto> {
    if (dto.toUserId === fromUserId) {
      throw new BadRequestException('Cannot connect with yourself');
    }
    const toUser = await this.users.findById(dto.toUserId);
    if (!toUser) throw new NotFoundException('User not found');

    const { userLowId, userHighId } = orderedPair(fromUserId, dto.toUserId);
    const existingConnection = await this.connections.findActiveConnection(
      userLowId,
      userHighId,
    );
    if (existingConnection) {
      throw new ConflictException('Already connected');
    }

    const pendingSame = await this.connections.findPendingBetween(
      fromUserId,
      dto.toUserId,
    );
    if (pendingSame) {
      throw new ConflictException('Connection request already pending');
    }

    const reversePending = await this.connections.findPendingBetween(
      dto.toUserId,
      fromUserId,
    );
    if (reversePending) {
      throw new ConflictException(
        'A reverse connection request is already pending — accept that instead',
      );
    }

    const created = await this.connections.createRequest({
      id: randomUUID(),
      fromUserId,
      toUserId: dto.toUserId,
      message: dto.message?.trim() ?? '',
    });

    await this.notifications.createNotification({
      recipientId: dto.toUserId,
      actorId: fromUserId,
      type: NotificationType.connection_request,
      title: created.fromUser.displayName,
      body: 'wants to connect with you',
      payload: {
        screen: 'connection_request',
        params: { requestId: created.id, userId: fromUserId },
      },
    });

    return ConnectionRequestResponseDto.fromEntity(created);
  }

  async listRequests(
    userId: string,
    query: ListConnectionRequestsQueryDto = {},
  ): Promise<ConnectionRequestResponseDto[]> {
    const direction = query.direction ?? ConnectionRequestDirection.all;
    const items = await this.connections.listRequestsForUser(userId, direction);
    return items.map((item) => ConnectionRequestResponseDto.fromEntity(item));
  }

  async acceptRequest(
    userId: string,
    requestId: string,
  ): Promise<ConnectionResponseDto> {
    const request = await this.connections.findRequestById(requestId);
    if (!request) throw new NotFoundException('Connection request not found');
    if (request.toUserId !== userId) {
      throw new ForbiddenException('Only the recipient can accept');
    }
    if (request.status !== ConnectionRequestStatus.pending) {
      throw new ConflictException('Request is no longer pending');
    }

    const { userLowId, userHighId } = orderedPair(
      request.fromUserId,
      request.toUserId,
    );
    const already = await this.connections.findActiveConnection(
      userLowId,
      userHighId,
    );
    if (already) {
      throw new ConflictException('Already connected');
    }

    await this.connections.updateRequestStatus(
      requestId,
      ConnectionRequestStatus.accepted,
    );
    await this.connections.cancelReversePending(
      request.fromUserId,
      request.toUserId,
    );

    const connection = await this.connections.createConnection({
      id: randomUUID(),
      userLowId,
      userHighId,
    });

    // Lazy conversation: created on first Message via openConnectionConversation.

    await this.notifications.createNotification({
      recipientId: request.fromUserId,
      actorId: userId,
      type: NotificationType.connection_accepted,
      title: request.toUser.displayName,
      body: 'accepted your connection request',
      payload: {
        screen: 'connection',
        params: { userId },
      },
    });

    return ConnectionResponseDto.fromEntity(connection, userId);
  }

  /**
   * Ensures a connection conversation exists for an active connection.
   * Called when the user taps Message — not on accept.
   */
  async openConnectionConversation(
    userId: string,
    peerUserId: string,
  ): Promise<{ conversationId: string }> {
    if (peerUserId === userId) {
      throw new BadRequestException('Cannot open a conversation with yourself');
    }
    const connection = await this.connections.findConnectionBetween(
      userId,
      peerUserId,
    );
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const conversation = await this.messaging.ensureConnectionConversation(
      connection.id,
      connection.userLowId,
      connection.userHighId,
    );
    return { conversationId: conversation.id };
  }

  async rejectRequest(userId: string, requestId: string): Promise<void> {
    const request = await this.connections.findRequestById(requestId);
    if (!request) throw new NotFoundException('Connection request not found');
    if (request.toUserId !== userId) {
      throw new ForbiddenException('Only the recipient can reject');
    }
    if (request.status !== ConnectionRequestStatus.pending) {
      throw new ConflictException('Request is no longer pending');
    }
    await this.connections.updateRequestStatus(
      requestId,
      ConnectionRequestStatus.rejected,
    );
  }

  async cancelRequest(userId: string, requestId: string): Promise<void> {
    const request = await this.connections.findRequestById(requestId);
    if (!request) throw new NotFoundException('Connection request not found');
    if (request.fromUserId !== userId) {
      throw new ForbiddenException('Only the sender can cancel');
    }
    if (request.status !== ConnectionRequestStatus.pending) {
      throw new ConflictException('Request is no longer pending');
    }
    await this.connections.updateRequestStatus(
      requestId,
      ConnectionRequestStatus.cancelled,
    );
  }

  async listConnections(userId: string): Promise<ConnectionResponseDto[]> {
    const items = await this.connections.listConnectionsForUser(userId);
    return items.map((item) => ConnectionResponseDto.fromEntity(item, userId));
  }

  async endConnection(userId: string, peerUserId: string): Promise<void> {
    if (peerUserId === userId) {
      throw new BadRequestException('Cannot end a connection with yourself');
    }
    const connection = await this.connections.findConnectionBetween(
      userId,
      peerUserId,
    );
    if (!connection) throw new NotFoundException('Connection not found');
    await this.connections.endConnection(connection.id, new Date());
  }
}

export { orderedPair };
