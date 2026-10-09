import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
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
  MutualConnectionsResponseDto,
} from './dto/connection-response.dto';
import {
  ConnectionRequestDirection,
  CreateConnectionRequestDto,
  ListConnectionRequestsQueryDto,
} from './dto/connection.dto';
import { mutualPeerIds } from './connection-lifecycle';
import {
  CONNECTIONS_REPOSITORY,
  orderedPair,
  type ConnectionsRepository,
} from './repositories/connections.repository';

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

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

    const submitted = await this.connections.submitRequest({
      id: randomUUID(),
      fromUserId,
      toUserId: dto.toUserId,
      message: dto.message?.trim() ?? '',
    });
    if (submitted.kind === 'conflict') {
      throw new ConflictException(submitted.message);
    }

    await this.notify({
      recipientId: dto.toUserId,
      actorId: fromUserId,
      type: NotificationType.connection_request,
      title: submitted.request.fromUser.displayName,
      body: 'wants to connect with you',
      payload: {
        screen: 'connection_request',
        params: {
          connectionRequestId: submitted.request.id,
          userId: fromUserId,
        },
      },
    });

    return ConnectionRequestResponseDto.fromEntity(submitted.request);
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
    const accepted = await this.connections.acceptPending({
      requestId,
      actorId: userId,
    });
    if (accepted.kind === 'not_found') {
      throw new NotFoundException('Connection request not found');
    }
    if (accepted.kind === 'forbidden') {
      throw new ForbiddenException('Only the recipient can accept');
    }
    if (accepted.kind === 'conflict') {
      throw new ConflictException(accepted.message);
    }

    const dto = ConnectionResponseDto.fromEntity(accepted.connection, userId);
    if (accepted.notify) {
      const accepter =
        accepted.connection.userLow.id === userId
          ? accepted.connection.userLow
          : accepted.connection.userHigh;
      await this.notify({
        recipientId: dto.peer.id,
        actorId: userId,
        type: NotificationType.connection_accepted,
        title: accepter.displayName,
        body: 'accepted your connection request',
        payload: {
          screen: 'connection',
          params: { userId },
        },
      });
    }
    return dto;
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
    const result = await this.connections.rejectPending({
      requestId,
      actorId: userId,
    });
    this.assertTerminal(result, 'Only the recipient can reject');
  }

  async cancelRequest(userId: string, requestId: string): Promise<void> {
    const result = await this.connections.cancelPending({
      requestId,
      actorId: userId,
    });
    this.assertTerminal(result, 'Only the sender can cancel');
  }

  async listConnections(userId: string): Promise<ConnectionResponseDto[]> {
    const items = await this.connections.listConnectionsForUser(userId);
    return items.map((item) => ConnectionResponseDto.fromEntity(item, userId));
  }

  async listMutualConnections(
    viewerId: string,
    targetUserId: string,
  ): Promise<MutualConnectionsResponseDto> {
    if (viewerId === targetUserId) {
      throw new BadRequestException('Use your own connections list');
    }
    const target = await this.users.findById(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    const [viewerPeers, targetPeers] = await Promise.all([
      this.connections.listActivePeerIds(viewerId),
      this.connections.listActivePeerIds(targetUserId),
    ]);
    const mutualIds = mutualPeerIds(
      viewerId,
      targetUserId,
      viewerPeers,
      targetPeers,
    );
    const people =
      mutualIds.length === 0
        ? []
        : await this.connections.listPublicConnectionUsers(mutualIds);

    const dto = new MutualConnectionsResponseDto();
    dto.connectionsCount = targetPeers.length;
    dto.items = people.map((person) => ({ ...person }));
    dto.mutualCount = dto.items.length;
    return dto;
  }

  async endConnection(userId: string, peerUserId: string): Promise<void> {
    if (peerUserId === userId) {
      throw new BadRequestException('Cannot end a connection with yourself');
    }
    const result = await this.connections.endActiveConnection(
      userId,
      peerUserId,
    );
    if (result === 'missing') {
      throw new NotFoundException('Connection not found');
    }
  }

  private assertTerminal(
    result: { kind: string; message?: string },
    forbiddenMessage: string,
  ): void {
    if (result.kind === 'not_found') {
      throw new NotFoundException('Connection request not found');
    }
    if (result.kind === 'forbidden') {
      throw new ForbiddenException(forbiddenMessage);
    }
    if (result.kind === 'conflict') {
      throw new ConflictException(result.message ?? 'Request is no longer pending');
    }
  }

  private async notify(input: {
    recipientId: string;
    actorId: string;
    type: NotificationType;
    title: string;
    body: string;
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.notifications.createNotification(input);
    } catch (error) {
      this.logger.error(
        `Connection notification failed (${input.type})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

export { orderedPair };
