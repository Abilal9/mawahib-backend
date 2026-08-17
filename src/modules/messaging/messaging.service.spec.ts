import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import {
  ConversationType,
  MediaPurpose,
  MediaStatus,
  MessageKind,
  WorkEngagementSource,
  WorkEngagementStatus,
} from '@prisma/client';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isConversationWritable, MessagingService } from './messaging.service';
import { MESSAGING_REPOSITORY } from './repositories/messaging.repository';
import type { ConversationWithRelations } from './repositories/messaging.repository';

function baseConversation(
  overrides: Partial<ConversationWithRelations> = {},
): ConversationWithRelations {
  return {
    id: 'c1',
    type: ConversationType.connection,
    connectionId: 'conn-1',
    workEngagementId: null,
    archivedAt: null,
    lastMessageAt: null,
    lastMessagePreview: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    participants: [
      {
        id: 'p1',
        conversationId: 'c1',
        userId: 'u1',
        lastReadAt: null,
        lastDeliveredAt: null,
        mutedAt: null,
        archivedAt: null,
        deletedAt: null,
        joinedAt: new Date(),
        user: {
          id: 'u1',
          displayName: 'Alice',
          username: 'alice',
          isVerified: false,
          profile: null,
        } as never,
      },
      {
        id: 'p2',
        conversationId: 'c1',
        userId: 'u2',
        lastReadAt: null,
        lastDeliveredAt: null,
        mutedAt: null,
        archivedAt: null,
        deletedAt: null,
        joinedAt: new Date(),
        user: {
          id: 'u2',
          displayName: 'Bob',
          username: 'bob',
          isVerified: false,
          profile: null,
        } as never,
      },
    ],
    connection: {
      id: 'conn-1',
      userLowId: 'u1',
      userHighId: 'u2',
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workEngagement: null,
    ...overrides,
  };
}

function workConversation(
  status: WorkEngagementStatus,
  overrides: Partial<ConversationWithRelations> = {},
): ConversationWithRelations {
  return baseConversation({
    type: ConversationType.work,
    connectionId: null,
    connection: null,
    workEngagementId: 'eng-1',
    workEngagement: {
      id: 'eng-1',
      listingId: null,
      applicationId: null,
      serviceOfferingId: null,
      clientId: 'u1',
      providerId: 'u2',
      title: 'Logo',
      status,
      source: WorkEngagementSource.direct,
      dueAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      detail: null,
      workRequest: null,
      reviews: [],
    },
    ...overrides,
  });
}

describe('isConversationWritable', () => {
  it('allows active connection chats', () => {
    expect(isConversationWritable(baseConversation())).toBe(true);
  });

  it('rejects ended connections and archived chats', () => {
    expect(
      isConversationWritable(
        baseConversation({
          connection: {
            id: 'conn-1',
            userLowId: 'u1',
            userHighId: 'u2',
            endedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      ),
    ).toBe(false);
    expect(
      isConversationWritable(baseConversation({ archivedAt: new Date() })),
    ).toBe(false);
  });

  it('allows work chat only in in_progress or delivered', () => {
    const workBase = workConversation(WorkEngagementStatus.in_progress);

    expect(isConversationWritable(workBase)).toBe(true);
    expect(
      isConversationWritable(
        workConversation(WorkEngagementStatus.delivered),
      ),
    ).toBe(true);
    expect(
      isConversationWritable(
        workConversation(WorkEngagementStatus.pending_payment),
      ),
    ).toBe(false);
    expect(
      isConversationWritable(workConversation(WorkEngagementStatus.completed)),
    ).toBe(false);
    expect(
      isConversationWritable(
        workConversation(WorkEngagementStatus.completed, {
          archivedAt: new Date(),
        }),
      ),
    ).toBe(false);
  });

  it('does not use per-participant archive for writability', () => {
    const conv = workConversation(WorkEngagementStatus.in_progress, {
      participants: [
        {
          id: 'p1',
          conversationId: 'c1',
          userId: 'u1',
          lastReadAt: null,
          lastDeliveredAt: null,
          mutedAt: null,
          archivedAt: new Date(),
          deletedAt: null,
          joinedAt: new Date(),
          user: {
            id: 'u1',
            displayName: 'Alice',
            username: 'alice',
            isVerified: false,
            profile: null,
          } as never,
        },
        {
          id: 'p2',
          conversationId: 'c1',
          userId: 'u2',
          lastReadAt: null,
          lastDeliveredAt: null,
          mutedAt: null,
          archivedAt: null,
          deletedAt: null,
          joinedAt: new Date(),
          user: {
            id: 'u2',
            displayName: 'Bob',
            username: 'bob',
            isVerified: false,
            profile: null,
          } as never,
        },
      ],
    });
    expect(isConversationWritable(conv)).toBe(true);
  });
});

describe('MessagingService', () => {
  let service: MessagingService;
  const messaging = {
    findConversationById: jest.fn(),
    findMessageByClientId: jest.fn(),
    createMessage: jest.fn(),
    updateConversationPreview: jest.fn(),
    findConversationByConnectionId: jest.fn(),
    findConversationByEngagementId: jest.fn(),
    createConversation: jest.fn(),
    listConversationsForUser: jest.fn(),
    findParticipant: jest.fn(),
    listMessages: jest.fn(),
    countUserMessages: jest.fn(),
    markParticipantRead: jest.fn(),
    markParticipantDelivered: jest.fn(),
    archiveConversation: jest.fn(),
    archiveForParticipant: jest.fn(),
    unarchiveForParticipant: jest.fn(),
    softDeleteForParticipant: jest.fn(),
    countUnreadForUser: jest.fn(),
    findWorkEngagementById: jest.fn(),
    findConnectionById: jest.fn(),
  };
  const notifications = {
    createNotification: jest.fn(),
  };
  const mediaService = {
    requireReadyOwnedAssets: jest.fn(),
    getSignedUrlForAsset: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mediaService.getSignedUrlForAsset.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: MESSAGING_REPOSITORY, useValue: messaging },
        { provide: NotificationsService, useValue: notifications },
        { provide: MediaService, useValue: mediaService },
      ],
    }).compile();
    service = module.get(MessagingService);
  });

  describe('onEngagementBecameInProgress', () => {
    it('creates work chat and notifies both participants once', async () => {
      messaging.findConversationByEngagementId.mockResolvedValue(null);
      const createdConv = workConversation(WorkEngagementStatus.in_progress);
      messaging.createConversation.mockResolvedValue(createdConv);
      messaging.createMessage.mockResolvedValue({
        id: 'sys-start',
        createdAt: new Date(),
      });
      messaging.findConversationById.mockResolvedValue(createdConv);

      await service.onEngagementBecameInProgress('eng-1', 'u1', 'u2');

      expect(messaging.createConversation).toHaveBeenCalled();
      expect(notifications.createNotification).toHaveBeenCalledTimes(2);
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'u1',
          body: 'A work chat was started',
        }),
      );
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'u2',
          body: 'A work chat was started',
        }),
      );
      const payload = (
        notifications.createNotification.mock.calls[0][0] as {
          payload: { params: { event: string; jobTitle?: string } };
        }
      ).payload;
      expect(payload.params.event).toBe('work_chat_started');
      expect(payload.params.jobTitle).toBe('Logo');
    });

    it('does not re-notify when work conversation already exists', async () => {
      messaging.findConversationByEngagementId.mockResolvedValue(
        workConversation(WorkEngagementStatus.in_progress),
      );
      messaging.createMessage.mockResolvedValue({
        id: 'sys-start',
        createdAt: new Date(),
      });
      messaging.findConversationById.mockResolvedValue(
        workConversation(WorkEngagementStatus.in_progress),
      );

      await service.onEngagementBecameInProgress('eng-1', 'u1', 'u2');

      expect(messaging.createConversation).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('onEngagementStatusChanged', () => {
    it('posts system message on completed but does not conversation-archive', async () => {
      messaging.findConversationByEngagementId.mockResolvedValue(
        workConversation(WorkEngagementStatus.delivered),
      );
      messaging.createMessage.mockResolvedValue({
        id: 'sys-1',
        createdAt: new Date(),
      });

      await service.onEngagementStatusChanged(
        'eng-1',
        WorkEngagementStatus.completed,
      );

      expect(messaging.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: MessageKind.system,
          body: 'Work completed',
        }),
      );
      expect(messaging.archiveConversation).not.toHaveBeenCalled();
      expect(messaging.archiveForParticipant).not.toHaveBeenCalled();
    });

    it('posts system message on delivered without archive', async () => {
      messaging.findConversationByEngagementId.mockResolvedValue(
        workConversation(WorkEngagementStatus.in_progress),
      );
      messaging.createMessage.mockResolvedValue({
        id: 'sys-2',
        createdAt: new Date(),
      });

      await service.onEngagementStatusChanged(
        'eng-1',
        WorkEngagementStatus.delivered,
      );

      expect(messaging.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Work delivered' }),
      );
      expect(messaging.archiveConversation).not.toHaveBeenCalled();
    });
  });

  describe('list / archive / soft-delete', () => {
    it('passes scope to listConversationsForUser', async () => {
      messaging.listConversationsForUser.mockResolvedValue([]);
      await service.listMyConversations('u1', { scope: 'archived' });
      expect(messaging.listConversationsForUser).toHaveBeenCalledWith(
        'u1',
        undefined,
        'archived',
      );
    });

    it('archives for the viewer only', async () => {
      const conv = baseConversation();
      messaging.findConversationById.mockResolvedValue(conv);
      await service.archiveConversationForMe('u1', 'c1');
      expect(messaging.archiveForParticipant).toHaveBeenCalledWith(
        'c1',
        'u1',
        expect.any(Date),
      );
    });

    it('unarchives for the viewer', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      await service.unarchiveConversationForMe('u1', 'c1');
      expect(messaging.unarchiveForParticipant).toHaveBeenCalledWith('c1', 'u1');
    });

    it('soft-deletes for the viewer', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      await service.deleteConversationForMe('u1', 'c1');
      expect(messaging.softDeleteForParticipant).toHaveBeenCalledWith(
        'c1',
        'u1',
        expect.any(Date),
      );
    });
  });

  describe('sendMessage', () => {
    it('rejects non-participants', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      await expect(
        service.sendMessage('stranger', 'c1', { body: 'hi' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects read-only conversations', async () => {
      messaging.findConversationById.mockResolvedValue(
        baseConversation({ archivedAt: new Date() }),
      );
      await expect(
        service.sendMessage('u1', 'c1', { body: 'hi' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('notifies peer only on the first connection message (no body leak)', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      const created = {
        id: 'm1',
        conversationId: 'c1',
        senderId: 'u1',
        kind: MessageKind.user,
        body: 'hello',
        clientMessageId: null,
        systemPayload: null,
        createdAt: new Date(),
        attachments: [],
        sender: {
          id: 'u1',
          displayName: 'Alice',
          username: 'alice',
          isVerified: false,
          profile: null,
        },
      };
      messaging.createMessage.mockResolvedValue(created);
      messaging.countUserMessages.mockResolvedValue(1);

      const result = await service.sendMessage('u1', 'c1', { body: 'hello' });
      expect(result.body).toBe('hello');
      expect(result.receiptStatus).toBe('sent');
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'u2',
          actorId: 'u1',
          title: 'Alice',
          body: 'started a chat with you',
        }),
      );
      const notifArg = notifications.createNotification.mock.calls[0][0] as {
        body: string;
        payload: { params: { event: string } };
      };
      expect(notifArg.body).not.toContain('hello');
      expect(notifArg.payload.params.event).toBe('conversation_started');
    });

    it('does not create in-app notifications for subsequent messages', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      messaging.createMessage.mockResolvedValue({
        id: 'm2',
        conversationId: 'c1',
        senderId: 'u1',
        kind: MessageKind.user,
        body: 'follow up',
        clientMessageId: null,
        systemPayload: null,
        createdAt: new Date(),
        attachments: [],
        sender: {
          id: 'u1',
          displayName: 'Alice',
          username: 'alice',
          isVerified: false,
          profile: null,
        },
      });
      messaging.countUserMessages.mockResolvedValue(2);

      await service.sendMessage('u1', 'c1', { body: 'follow up' });
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('does not create message notifications for work chat messages', async () => {
      messaging.findConversationById.mockResolvedValue(
        workConversation(WorkEngagementStatus.in_progress),
      );
      messaging.createMessage.mockResolvedValue({
        id: 'm3',
        conversationId: 'c1',
        senderId: 'u1',
        kind: MessageKind.user,
        body: 'hello work',
        clientMessageId: null,
        systemPayload: null,
        createdAt: new Date(),
        attachments: [],
        sender: {
          id: 'u1',
          displayName: 'Alice',
          username: 'alice',
          isVerified: false,
          profile: null,
        },
      });

      await service.sendMessage('u1', 'c1', { body: 'hello work' });
      expect(messaging.countUserMessages).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('rejects oversized message bodies', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      const body = 'x'.repeat(1001);
      await expect(service.sendMessage('u1', 'c1', { body })).rejects.toThrow(
        /too long/,
      );
      expect(messaging.createMessage).not.toHaveBeenCalled();
    });

    it('returns delivered receipt when peer delivery watermark covers message', async () => {
      const createdAt = new Date('2026-08-17T12:00:00.000Z');
      messaging.findConversationById.mockResolvedValue(
        baseConversation({
          participants: [
            {
              id: 'p1',
              conversationId: 'c1',
              userId: 'u1',
              lastReadAt: null,
              lastDeliveredAt: null,
              mutedAt: null,
              archivedAt: null,
              deletedAt: null,
              joinedAt: new Date(),
              user: {
                id: 'u1',
                displayName: 'Alice',
                username: 'alice',
                isVerified: false,
                profile: null,
              } as never,
            },
            {
              id: 'p2',
              conversationId: 'c1',
              userId: 'u2',
              lastReadAt: null,
              lastDeliveredAt: new Date('2026-08-17T12:01:00.000Z'),
              mutedAt: null,
              archivedAt: null,
              deletedAt: null,
              joinedAt: new Date(),
              user: {
                id: 'u2',
                displayName: 'Bob',
                username: 'bob',
                isVerified: false,
                profile: null,
              } as never,
            },
          ],
        }),
      );
      messaging.listMessages.mockResolvedValue([
        {
          id: 'm1',
          conversationId: 'c1',
          senderId: 'u1',
          kind: MessageKind.user,
          body: 'hello',
          clientMessageId: null,
          systemPayload: null,
          createdAt,
          attachments: [],
          sender: null,
        },
      ]);

      const page = await service.listMessages('u1', 'c1', { limit: 30 });
      expect(page.items[0].receiptStatus).toBe('delivered');
      expect(messaging.markParticipantDelivered).not.toHaveBeenCalled();
    });

    it('returns read receipt when peer lastReadAt covers message', async () => {
      const createdAt = new Date('2026-08-17T12:00:00.000Z');
      messaging.findConversationById.mockResolvedValue(
        baseConversation({
          participants: [
            {
              id: 'p1',
              conversationId: 'c1',
              userId: 'u1',
              lastReadAt: null,
              lastDeliveredAt: null,
              mutedAt: null,
              archivedAt: null,
              deletedAt: null,
              joinedAt: new Date(),
              user: {
                id: 'u1',
                displayName: 'Alice',
                username: 'alice',
                isVerified: false,
                profile: null,
              } as never,
            },
            {
              id: 'p2',
              conversationId: 'c1',
              userId: 'u2',
              lastReadAt: new Date('2026-08-17T12:02:00.000Z'),
              lastDeliveredAt: new Date('2026-08-17T12:01:00.000Z'),
              mutedAt: null,
              archivedAt: null,
              deletedAt: null,
              joinedAt: new Date(),
              user: {
                id: 'u2',
                displayName: 'Bob',
                username: 'bob',
                isVerified: false,
                profile: null,
              } as never,
            },
          ],
        }),
      );
      messaging.listMessages.mockResolvedValue([
        {
          id: 'm1',
          conversationId: 'c1',
          senderId: 'u1',
          kind: MessageKind.user,
          body: 'hello',
          clientMessageId: null,
          systemPayload: null,
          createdAt,
          attachments: [],
          sender: null,
        },
      ]);

      const page = await service.listMessages('u1', 'c1', { limit: 30 });
      expect(page.items[0].receiptStatus).toBe('read');
    });

    it('returns existing message on clientMessageId conflict', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      const existing = {
        id: 'm-existing',
        conversationId: 'c1',
        senderId: 'u1',
        kind: MessageKind.user,
        body: 'retry',
        clientMessageId: 'cid-1',
        systemPayload: null,
        createdAt: new Date(),
        attachments: [],
        sender: null,
      };
      messaging.findMessageByClientId.mockResolvedValue(existing);

      const result = await service.sendMessage('u1', 'c1', {
        body: 'retry',
        clientMessageId: 'cid-1',
      });
      expect(result.id).toBe('m-existing');
      expect(messaging.createMessage).not.toHaveBeenCalled();
    });

    it('requires message-purpose media', async () => {
      messaging.findConversationById.mockResolvedValue(baseConversation());
      mediaService.requireReadyOwnedAssets.mockResolvedValue([
        {
          id: 'media-1',
          purpose: MediaPurpose.portfolio,
          status: MediaStatus.ready,
        },
      ]);

      await expect(
        service.sendMessage('u1', 'c1', {
          mediaAssetIds: ['media-1'],
        }),
      ).rejects.toThrow(/purpose=message/);
    });
  });
});
