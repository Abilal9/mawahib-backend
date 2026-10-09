import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionRequestStatus, NotificationType } from '@prisma/client';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import { ConnectionsService } from './connections.service';
import {
  CONNECTIONS_REPOSITORY,
  orderedPair,
} from './repositories/connections.repository';

describe('orderedPair', () => {
  it('orders ids lexicographically', () => {
    expect(orderedPair('b', 'a')).toEqual({
      userLowId: 'a',
      userHighId: 'b',
    });
    expect(orderedPair('a', 'b')).toEqual({
      userLowId: 'a',
      userHighId: 'b',
    });
  });
});

describe('ConnectionsService', () => {
  let service: ConnectionsService;
  const connections = {
    createRequest: jest.fn(),
    findRequestById: jest.fn(),
    findPendingBetween: jest.fn(),
    listRequestsForUser: jest.fn(),
    updateRequestStatus: jest.fn(),
    cancelReversePending: jest.fn(),
    findActiveConnection: jest.fn(),
    createConnection: jest.fn(),
    listConnectionsForUser: jest.fn(),
    findConnectionBetween: jest.fn(),
    endConnection: jest.fn(),
    submitRequest: jest.fn(),
    acceptPending: jest.fn(),
    rejectPending: jest.fn(),
    cancelPending: jest.fn(),
    endActiveConnection: jest.fn(),
    listActivePeerIds: jest.fn(),
    listPublicConnectionUsers: jest.fn(),
  };
  const users = { findById: jest.fn() };
  const messaging = { ensureConnectionConversation: jest.fn() };
  const notifications = { createNotification: jest.fn() };

  const peerUser = {
    id: 'u2',
    displayName: 'Bob',
    username: 'bob',
    isVerified: false,
    profile: null,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsService,
        { provide: CONNECTIONS_REPOSITORY, useValue: connections },
        { provide: USER_REPOSITORY, useValue: users },
        { provide: MessagingService, useValue: messaging },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(ConnectionsService);
  });

  it('rejects self-connect', async () => {
    await expect(
      service.createRequest('u1', { toUserId: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate pending and already connected', async () => {
    users.findById.mockResolvedValue(peerUser);
    connections.submitRequest.mockResolvedValue({
      kind: 'conflict',
      message: 'Already connected',
    });
    await expect(
      service.createRequest('u1', { toUserId: 'u2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('creates a request and notifies the recipient', async () => {
    users.findById.mockResolvedValue(peerUser);
    const created = {
      id: 'r1',
      fromUserId: 'u1',
      toUserId: 'u2',
      status: ConnectionRequestStatus.pending,
      message: 'Hi',
      createdAt: new Date(),
      updatedAt: new Date(),
      fromUser: {
        id: 'u1',
        displayName: 'Alice',
        username: 'alice',
        isVerified: false,
        profile: null,
      },
      toUser: peerUser,
    };
    connections.submitRequest.mockResolvedValue({ kind: 'ok', request: created });

    const result = await service.createRequest('u1', {
      toUserId: 'u2',
      message: 'Hi',
    });
    expect(result.id).toBe('r1');
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'u2',
        type: NotificationType.connection_request,
        payload: {
          screen: 'connection_request',
          params: { connectionRequestId: 'r1', userId: 'u1' },
        },
      }),
    );
  });

  it('accepts a request without creating conversation, notifies requester', async () => {
    const connection = {
      id: 'conn-1',
      userLowId: 'u1',
      userHighId: 'u2',
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userLow: {
        id: 'u1',
        displayName: 'Alice',
        username: 'alice',
        isVerified: false,
        profile: null,
      },
      userHigh: peerUser,
      conversation: null,
    };
    connections.acceptPending.mockResolvedValue({
      kind: 'ok',
      connection,
      notify: true,
    });

    const result = await service.acceptRequest('u2', 'r1');
    expect(result.peer.id).toBe('u1');
    expect(result.conversationId).toBeNull();
    expect(messaging.ensureConnectionConversation).not.toHaveBeenCalled();
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'u1',
        type: NotificationType.connection_accepted,
      }),
    );
  });

  it('openConnectionConversation ensures conversation for active connection', async () => {
    connections.findConnectionBetween.mockResolvedValue({
      id: 'conn-1',
      userLowId: 'u1',
      userHighId: 'u2',
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userLow: {
        id: 'u1',
        displayName: 'Alice',
        username: 'alice',
        isVerified: false,
        profile: null,
      },
      userHigh: peerUser,
      conversation: null,
    });
    messaging.ensureConnectionConversation.mockResolvedValue({
      id: 'conv-1',
    });

    const result = await service.openConnectionConversation('u1', 'u2');
    expect(result).toEqual({ conversationId: 'conv-1' });
    expect(messaging.ensureConnectionConversation).toHaveBeenCalledWith(
      'conn-1',
      'u1',
      'u2',
    );
  });

  it('openConnectionConversation throws when not connected', async () => {
    connections.findConnectionBetween.mockResolvedValue(null);
    await expect(
      service.openConnectionConversation('u1', 'u2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messaging.ensureConnectionConversation).not.toHaveBeenCalled();
  });

  it('forbids accept by non-recipient', async () => {
    connections.acceptPending.mockResolvedValue({ kind: 'forbidden' });
    await expect(service.acceptRequest('u1', 'r1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('does not notify again when accept is idempotent', async () => {
    connections.acceptPending.mockResolvedValue({
      kind: 'ok',
      notify: false,
      connection: {
        id: 'conn-1',
        userLowId: 'u1',
        userHighId: 'u2',
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        userLow: {
          id: 'u1',
          displayName: 'Alice',
          username: 'alice',
          isVerified: false,
          profile: null,
        },
        userHigh: peerUser,
        conversation: null,
      },
    });
    const result = await service.acceptRequest('u2', 'r1');
    expect(result.peer.id).toBe('u1');
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('still returns the connection when the accepted notification fails', async () => {
    connections.acceptPending.mockResolvedValue({
      kind: 'ok',
      notify: true,
      connection: {
        id: 'conn-1',
        userLowId: 'u1',
        userHighId: 'u2',
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        userLow: {
          id: 'u1',
          displayName: 'Alice',
          username: 'alice',
          isVerified: false,
          profile: null,
        },
        userHigh: peerUser,
        conversation: null,
      },
    });
    notifications.createNotification.mockRejectedValue(new Error('push down'));
    const result = await service.acceptRequest('u2', 'r1');
    expect(result.peer.id).toBe('u1');
  });

  it('soft-ends a connection without deleting conversation', async () => {
    connections.endActiveConnection.mockResolvedValue('ended');

    await service.endConnection('u1', 'u2');
    expect(connections.endActiveConnection).toHaveBeenCalledWith('u1', 'u2');
  });

  it('rejects mutual connections with yourself', async () => {
    await expect(
      service.listMutualConnections('u1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(connections.listActivePeerIds).not.toHaveBeenCalled();
  });

  it('returns only the mutual public summary and the target edge count', async () => {
    users.findById.mockResolvedValue(peerUser);
    connections.listActivePeerIds.mockImplementation(async (id: string) =>
      id === 'u1' ? ['c', 'd'] : ['c', 'e'],
    );
    connections.listPublicConnectionUsers.mockResolvedValue([
      {
        id: 'c',
        displayName: 'Cara',
        username: 'cara',
        isVerified: false,
        avatarUrl: null,
        title: 'Designer',
      },
    ]);

    const result = await service.listMutualConnections('u1', 'u2');
    expect(result.connectionsCount).toBe(2);
    expect(result.mutualCount).toBe(1);
    expect(result.items).toEqual([
      {
        id: 'c',
        displayName: 'Cara',
        username: 'cara',
        isVerified: false,
        avatarUrl: null,
        title: 'Designer',
      },
    ]);
    expect(connections.listPublicConnectionUsers).toHaveBeenCalledWith(['c']);
    expect(JSON.stringify(result.items)).not.toMatch(/email|phone/i);
  });

  it('returns an empty mutual list without hydrating peers', async () => {
    users.findById.mockResolvedValue(peerUser);
    connections.listActivePeerIds.mockImplementation(async (id: string) =>
      id === 'u1' ? ['c'] : ['d'],
    );
    const result = await service.listMutualConnections('u1', 'u2');
    expect(result.mutualCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.connectionsCount).toBe(1);
    expect(connections.listPublicConnectionUsers).not.toHaveBeenCalled();
  });
});
