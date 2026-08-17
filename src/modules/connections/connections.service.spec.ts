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
    connections.findActiveConnection.mockResolvedValue({ id: 'c1' });
    await expect(
      service.createRequest('u1', { toUserId: 'u2' }),
    ).rejects.toBeInstanceOf(ConflictException);

    connections.findActiveConnection.mockResolvedValue(null);
    connections.findPendingBetween.mockResolvedValueOnce({ id: 'r1' });
    await expect(
      service.createRequest('u1', { toUserId: 'u2' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a request and notifies the recipient', async () => {
    users.findById.mockResolvedValue(peerUser);
    connections.findActiveConnection.mockResolvedValue(null);
    connections.findPendingBetween.mockResolvedValue(null);
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
    connections.createRequest.mockResolvedValue(created);

    const result = await service.createRequest('u1', {
      toUserId: 'u2',
      message: 'Hi',
    });
    expect(result.id).toBe('r1');
    expect(notifications.createNotification).toHaveBeenCalled();
  });

  it('accepts a request without creating conversation, notifies requester', async () => {
    connections.findRequestById.mockResolvedValue({
      id: 'r1',
      fromUserId: 'u1',
      toUserId: 'u2',
      status: ConnectionRequestStatus.pending,
      message: '',
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
    });
    connections.findActiveConnection.mockResolvedValue(null);
    connections.updateRequestStatus.mockResolvedValue({});
    connections.cancelReversePending.mockResolvedValue(0);
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
    connections.createConnection.mockResolvedValue(connection);

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
    connections.findRequestById.mockResolvedValue({
      id: 'r1',
      fromUserId: 'u1',
      toUserId: 'u2',
      status: ConnectionRequestStatus.pending,
      message: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      fromUser: peerUser,
      toUser: peerUser,
    });
    await expect(service.acceptRequest('u1', 'r1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('soft-ends a connection without deleting conversation', async () => {
    connections.findConnectionBetween.mockResolvedValue({
      id: 'conn-1',
      userLowId: 'u1',
      userHighId: 'u2',
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userLow: peerUser,
      userHigh: peerUser,
    });
    connections.endConnection.mockResolvedValue({});

    await service.endConnection('u1', 'u2');
    expect(connections.endConnection).toHaveBeenCalledWith(
      'conn-1',
      expect.any(Date),
    );
  });
});
