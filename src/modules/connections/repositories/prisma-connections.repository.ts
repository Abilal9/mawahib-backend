import { Injectable } from '@nestjs/common';
import { ConnectionRequestStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  activeConnectionWhere,
  planAccept,
  planCreateRequest,
  planTerminal,
} from '../connection-lifecycle';
import {
  AcceptPendingResult,
  ConnectionsRepository,
  ConnectionRequestWithUsers,
  ConnectionWithUsers,
  CreateConnectionInput,
  CreateConnectionRequestInput,
  orderedPair,
  PublicConnectionUser,
  SubmitRequestResult,
  TerminalRequestResult,
} from './connections.repository';
import type { Connection, ConnectionRequest } from '@prisma/client';

const TX = { maxWait: 5000, timeout: 10000 } as const;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function lockPair(
  tx: Prisma.TransactionClient,
  userLowId: string,
  userHighId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userLowId}), hashtext(${userHighId}))`;
}

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

  async listActivePeerIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.connection.findMany({
      where: activeConnectionWhere(userId),
      select: { userLowId: true, userHighId: true },
    });
    return rows.map((row) =>
      row.userLowId === userId ? row.userHighId : row.userLowId,
    );
  }

  async listPublicConnectionUsers(
    ids: string[],
  ): Promise<PublicConnectionUser[]> {
    if (ids.length === 0) return [];
    // TODO: cap or paginate if mutual sets grow past MVP size.
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        username: true,
        isVerified: true,
        profile: { select: { avatarUrl: true, title: true } },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      username: row.username,
      isVerified: row.isVerified,
      avatarUrl: row.profile?.avatarUrl ?? null,
      title: row.profile?.title ?? null,
    }));
  }

  listConnectionsForUser(userId: string): Promise<ConnectionWithUsers[]> {
    return this.prisma.connection.findMany({
      where: activeConnectionWhere(userId),
      include: connectionInclude,
      orderBy: { updatedAt: 'desc' },
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

  async submitRequest(
    input: CreateConnectionRequestInput,
  ): Promise<SubmitRequestResult> {
    const pair = orderedPair(input.fromUserId, input.toUserId);
    try {
      const written = await this.prisma.$transaction(async (tx) => {
        await lockPair(tx, pair.userLowId, pair.userHighId);
        const active = await tx.connection.findFirst({
          where: {
            userLowId: pair.userLowId,
            userHighId: pair.userHighId,
            endedAt: null,
          },
          select: { id: true },
        });
        const reverse = await tx.connectionRequest.findFirst({
          where: {
            fromUserId: input.toUserId,
            toUserId: input.fromUserId,
            status: ConnectionRequestStatus.pending,
          },
          select: { id: true },
        });
        const same = await tx.connectionRequest.findUnique({
          where: {
            fromUserId_toUserId: {
              fromUserId: input.fromUserId,
              toUserId: input.toUserId,
            },
          },
        });
        const plan = planCreateRequest({
          activeConnection: Boolean(active),
          reversePending: Boolean(reverse),
          sameDirection: same,
        });
        if (plan.type === 'conflict') return plan;
        if (plan.type === 'reopen') {
          await tx.connectionRequest.update({
            where: { id: plan.requestId },
            data: {
              status: ConnectionRequestStatus.pending,
              message: input.message,
              createdAt: new Date(),
            },
          });
          return { type: 'ok' as const, id: plan.requestId };
        }
        await tx.connectionRequest.create({
          data: {
            id: input.id,
            fromUserId: input.fromUserId,
            toUserId: input.toUserId,
            message: input.message,
            status: ConnectionRequestStatus.pending,
          },
        });
        return { type: 'ok' as const, id: input.id };
      }, TX);
      if (written.type === 'conflict') {
        return { kind: 'conflict', message: written.message };
      }
      const request = await this.findRequestById(written.id);
      if (!request) {
        return { kind: 'conflict', message: 'Could not load connection request' };
      }
      return { kind: 'ok', request };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return {
          kind: 'conflict',
          message: 'Connection request already pending',
        };
      }
      throw error;
    }
  }

  async acceptPending(input: {
    requestId: string;
    actorId: string;
  }): Promise<AcceptPendingResult> {
    const preview = await this.prisma.connectionRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!preview) return { kind: 'not_found' };
    const pair = orderedPair(preview.fromUserId, preview.toUserId);
    try {
      const written = await this.prisma.$transaction(async (tx) => {
        await lockPair(tx, pair.userLowId, pair.userHighId);
        const request = await tx.connectionRequest.findUnique({
          where: { id: input.requestId },
        });
        const connection = await tx.connection.findUnique({
          where: {
            userLowId_userHighId: {
              userLowId: pair.userLowId,
              userHighId: pair.userHighId,
            },
          },
        });
        const plan = planAccept({
          actorId: input.actorId,
          request,
          connection,
        });
        if (
          plan.type === 'not_found' ||
          plan.type === 'forbidden' ||
          plan.type === 'conflict' ||
          plan.type === 'idempotent'
        ) {
          return plan;
        }

        const updated = await tx.connectionRequest.updateMany({
          where: {
            id: input.requestId,
            status: ConnectionRequestStatus.pending,
          },
          data: { status: ConnectionRequestStatus.accepted },
        });
        if (updated.count !== 1) {
          return {
            type: 'conflict' as const,
            message: 'Request is no longer pending',
          };
        }
        await tx.connectionRequest.updateMany({
          where: {
            fromUserId: request!.toUserId,
            toUserId: request!.fromUserId,
            status: ConnectionRequestStatus.pending,
          },
          data: { status: ConnectionRequestStatus.cancelled },
        });

        if (plan.type === 'use_existing' || plan.type === 'reactivate') {
          if (plan.type === 'reactivate') {
            await tx.connection.update({
              where: { id: plan.connectionId },
              data: { endedAt: null },
            });
          }
          return {
            type: 'ok' as const,
            connectionId: plan.connectionId,
            notify: plan.type === 'reactivate',
          };
        }

        const created = await tx.connection.create({
          data: {
            id: randomUUID(),
            userLowId: pair.userLowId,
            userHighId: pair.userHighId,
          },
        });
        return {
          type: 'ok' as const,
          connectionId: created.id,
          notify: true,
        };
      }, TX);

      if (written.type === 'not_found') return { kind: 'not_found' };
      if (written.type === 'forbidden') return { kind: 'forbidden' };
      if (written.type === 'conflict') {
        return { kind: 'conflict', message: written.message };
      }
      const connectionId = written.connectionId;
      const notify = written.type === 'ok' ? written.notify : false;
      const connection = await this.prisma.connection.findUnique({
        where: { id: connectionId },
        include: connectionInclude,
      });
      if (!connection) {
        return {
          kind: 'conflict',
          message: 'This request was accepted. Refresh and continue.',
        };
      }
      return { kind: 'ok', connection, notify };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { kind: 'conflict', message: 'Already connected' };
      }
      throw error;
    }
  }

  async rejectPending(input: {
    requestId: string;
    actorId: string;
  }): Promise<TerminalRequestResult> {
    return this.finishPending(input.requestId, input.actorId, 'recipient', ConnectionRequestStatus.rejected);
  }

  async cancelPending(input: {
    requestId: string;
    actorId: string;
  }): Promise<TerminalRequestResult> {
    return this.finishPending(input.requestId, input.actorId, 'sender', ConnectionRequestStatus.cancelled);
  }

  async endActiveConnection(
    userId: string,
    peerUserId: string,
  ): Promise<'missing' | 'ended'> {
    const pair = orderedPair(userId, peerUserId);
    return this.prisma.$transaction(async (tx) => {
      await lockPair(tx, pair.userLowId, pair.userHighId);
      const row = await tx.connection.findFirst({
        where: {
          userLowId: pair.userLowId,
          userHighId: pair.userHighId,
          endedAt: null,
        },
        select: { id: true },
      });
      if (!row) return 'missing';
      await tx.connection.update({
        where: { id: row.id },
        data: { endedAt: new Date() },
      });
      return 'ended';
    }, TX);
  }

  private async finishPending(
    requestId: string,
    actorId: string,
    role: 'recipient' | 'sender',
    status: ConnectionRequestStatus,
  ): Promise<TerminalRequestResult> {
    const preview = await this.prisma.connectionRequest.findUnique({
      where: { id: requestId },
    });
    if (!preview) return { kind: 'not_found' };
    const pair = orderedPair(preview.fromUserId, preview.toUserId);
    const written = await this.prisma.$transaction(async (tx) => {
      await lockPair(tx, pair.userLowId, pair.userHighId);
      const request = await tx.connectionRequest.findUnique({
        where: { id: requestId },
      });
      const plan = planTerminal({ actorId, role, request });
      if (plan.type !== 'ok') return plan;
      const updated = await tx.connectionRequest.updateMany({
        where: { id: requestId, status: ConnectionRequestStatus.pending },
        data: { status },
      });
      if (updated.count !== 1) {
        return {
          type: 'conflict' as const,
          message: 'Request is no longer pending',
        };
      }
      return { type: 'ok' as const };
    }, TX);
    if (written.type === 'not_found') return { kind: 'not_found' };
    if (written.type === 'forbidden') return { kind: 'forbidden' };
    if (written.type === 'conflict') {
      return { kind: 'conflict', message: written.message };
    }
    return { kind: 'ok' };
  }
}
