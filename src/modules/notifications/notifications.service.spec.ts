import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_REPOSITORY } from './repositories/notification.repository';

describe('NotificationsService', () => {
  let service: NotificationsService;
  const notifications = {
    create: jest.fn(),
    listForUser: jest.fn(),
    findOwnedById: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    unreadCount: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NOTIFICATION_REPOSITORY, useValue: notifications },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('creates a notification', async () => {
    const created = {
      id: 'n1',
      recipientId: 'u1',
      actorId: 'u2',
      type: NotificationType.connection_request,
      title: 'New request',
      body: 'Hi',
      payload: {},
      readAt: null,
      createdAt: new Date(),
      actor: {
        id: 'u2',
        displayName: 'Ada',
        username: 'ada',
        profile: { avatarUrl: null },
      },
    };
    notifications.create.mockResolvedValue(created);

    const result = await service.createNotification({
      recipientId: 'u1',
      actorId: 'u2',
      type: NotificationType.connection_request,
      title: 'New request',
      body: 'Hi',
    });

    expect(result.id).toBe('n1');
    expect(result.type).toBe(NotificationType.connection_request);
    expect(notifications.create).toHaveBeenCalled();
  });

  it('lists notifications for a user', async () => {
    notifications.listForUser.mockResolvedValue([]);
    await expect(service.listForUser('u1')).resolves.toEqual([]);
    expect(notifications.listForUser).toHaveBeenCalledWith('u1', {
      take: undefined,
      skip: undefined,
    });
  });

  it('marks a notification as read', async () => {
    const existing = {
      id: 'n1',
      recipientId: 'u1',
      actorId: null,
      type: NotificationType.system,
      title: 'Hello',
      body: '',
      payload: {},
      readAt: null,
      createdAt: new Date(),
      actor: null,
    };
    notifications.findOwnedById.mockResolvedValue(existing);
    notifications.markRead.mockResolvedValue({
      ...existing,
      readAt: new Date(),
    });

    const result = await service.markRead('u1', 'n1');
    expect(result.readAt).toBeTruthy();
  });

  it('returns existing when already read', async () => {
    const existing = {
      id: 'n1',
      recipientId: 'u1',
      actorId: null,
      type: NotificationType.system,
      title: 'Hello',
      body: '',
      payload: {},
      readAt: new Date('2026-01-01'),
      createdAt: new Date(),
      actor: null,
    };
    notifications.findOwnedById.mockResolvedValue(existing);

    const result = await service.markRead('u1', 'n1');
    expect(result.readAt).toBe('2026-01-01T00:00:00.000Z');
    expect(notifications.markRead).not.toHaveBeenCalled();
  });

  it('throws when notification is missing', async () => {
    notifications.findOwnedById.mockResolvedValue(null);
    await expect(service.markRead('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marks all as read and returns unread count', async () => {
    notifications.markAllRead.mockResolvedValue(3);
    notifications.unreadCount.mockResolvedValue(0);

    await expect(service.markAllRead('u1')).resolves.toEqual({
      updatedCount: 3,
    });
    await expect(service.unreadCount('u1')).resolves.toEqual({
      unreadCount: 0,
    });
  });
});
