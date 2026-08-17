import { Injectable } from '@nestjs/common';
import { ConnectionRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  ConnectionsRepository,
  ConnectionRequestWithUsers,
  ConnectionWithUsers,
  CreateConnectionInput,
  CreateConnectionRequestInput,
} from './connections.repository';
import type { Connection, ConnectionRequest } from '@prisma/client';

const userInclude = {
  include: { profile: true },
} as const;

const requestInclude = {
  fromUser: userInclude,
  toUser: userInclude,
} satisfies Prisma.ConnectionRequestInclude;

const connectionInclude = {
  userLow: userInclude,
  userHigh: userInclude,
  conversation: { select: { id: true } },
} satisfies Prisma.ConnectionInclude;

@Injectable()
export class PrismaConnectionsRepository implements ConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createRequest(
    input: CreateConnectionRequestInput,
  ): Promise<ConnectionRequestWithUsers> {
    return this.prisma.connectionRequest.create({
      data: {
        id: input.id,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        message: input.message,
        status: ConnectionRequestStatus.pending,
      },
      include: requestInclude,
    });
  }

  findRequestById(id: string): Promise<ConnectionRequestWithUsers | null> {
    return this.prisma.connectionRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
  }

  findPendingBetween(
    fromUserId: string,
    toUserId: string,
  ): Promise<ConnectionRequest | null> {
    return this.prisma.connectionRequest.findFirst({
      where: {
        fromUserId,
        toUserId,
        status: ConnectionRequestStatus.pending,
      },
    });
  }

  listRequestsForUser(
    userId: string,
    direction: 'incoming' | 'outgoing' | 'all',
  ): Promise<ConnectionRequestWithUsers[]> {
    const where =
      direction === 'incoming'
        ? { toUserId: userId }
        : direction === 'outgoing'
          ? { fromUserId: userId }
          : {
              OR: [{ fromUserId: userId }, { toUserId: userId }],
            };

    return this.prisma.connectionRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  updateRequestStatus(
    id: string,
    status: ConnectionRequestStatus,
  ): Promise<ConnectionRequestWithUsers> {
    return this.prisma.connectionRequest.update({
      where: { id },
      data: { status },
      include: requestInclude,
    });
  }

  async cancelReversePending(
    fromUserId: string,
    toUserId: string,
  ): Promise<number> {
    const result = await this.prisma.connectionRequest.updateMany({
      where: {
        fromUserId: toUserId,
        toUserId: fromUserId,
        status: ConnectionRequestStatus.pending,
      },
      data: { status: ConnectionRequestStatus.cancelled },
    });
    return result.count;
  }

  findActiveConnection(
    userLowId: string,
    userHighId: string,
  ): Promise<Connection | null> {
    return this.prisma.connection.findFirst({
      where: { userLowId, userHighId, endedAt: null },
    });
  }

  createConnection(input: CreateConnectionInput): Promise<ConnectionWithUsers> {
    return this.prisma.connection.create({
      data: {
        id: input.id,
        userLowId: input.userLowId,
        userHighId: input.userHighId,
      },
      include: connectionInclude,
    });
  }

  listConnectionsForUser(userId: string): Promise<ConnectionWithUsers[]> {
    return this.prisma.connection.findMany({
      where: {
        endedAt: null,
        OR: [{ userLowId: userId }, { userHighId: userId }],
      },
      include: connectionInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  findConnectionBetween(
    userA: string,
    userB: string,
  ): Promise<ConnectionWithUsers | null> {
    const [low, high] = userA < userB ? [userA, userB] : [userB, userA];
    return this.prisma.connection.findFirst({
      where: {
        userLowId: low,
        userHighId: high,
        endedAt: null,
      },
      include: connectionInclude,
    });
  }

  endConnection(id: string, endedAt: Date): Promise<ConnectionWithUsers> {
    return this.prisma.connection.update({
      where: { id },
      data: { endedAt },
      include: connectionInclude,
    });
  }
}
