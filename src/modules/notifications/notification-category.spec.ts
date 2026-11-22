import 'reflect-metadata';
import { NotificationType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import {
  NOTIFICATION_CATEGORIES,
  categoryForNotificationType,
  notificationTypesForCategory,
} from './notification-category';
import { notificationListWhere, sliceNotificationPage } from './notification-page';

describe('notification categories', () => {
  it('assigns every stored type to exactly one category', () => {
    for (const type of Object.values(NotificationType)) {
      const matches = NOTIFICATION_CATEGORIES.filter((category) =>
        notificationTypesForCategory(category).includes(type),
      );
      expect(matches).toEqual([categoryForNotificationType(type)]);
    }
    expect(categoryForNotificationType(NotificationType.system)).toBe('platform_updates');
    expect(categoryForNotificationType(NotificationType.engagement_status)).toBe('jobs');
    expect(categoryForNotificationType(NotificationType.work_request_event)).toBe('jobs');
    expect(categoryForNotificationType(NotificationType.message_received)).toBe('messages');
    expect(categoryForNotificationType(NotificationType.connection_request)).toBe('connections');
    expect(categoryForNotificationType(NotificationType.connection_accepted)).toBe('connections');
    expect(categoryForNotificationType(NotificationType.post_liked)).toBe('posts');
    expect(categoryForNotificationType(NotificationType.post_commented)).toBe('posts');
  });

  it('rejects a category that is not one of the tabs', async () => {
    for (const category of ['all', '', 'marketing', ['jobs', 'posts']]) {
      const dto = plainToInstance(ListNotificationsQueryDto, { category });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'category')).toBe(true);
    }
    const omitted = await validate(plainToInstance(ListNotificationsQueryDto, {}));
    expect(omitted).toEqual([]);
    const jobs = await validate(plainToInstance(ListNotificationsQueryDto, { category: 'jobs' }));
    expect(jobs).toEqual([]);
  });

  it('filters the keyset by category before the page size', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      createdAt: new Date(Date.UTC(2026, 10, 22, 12, 0, 20 - index)),
      type: NotificationType.message_received,
    }));
    const job = {
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: new Date(Date.UTC(2026, 10, 1)),
      type: NotificationType.engagement_status,
    };
    const rows = [...messages, job];
    const jobs = sliceNotificationPage(rows, {
      take: 21,
      cursor: null,
      types: notificationTypesForCategory('jobs'),
    });
    expect(jobs.map((row) => row.id)).toEqual([job.id]);

    const where = notificationListWhere('user-1', null, notificationTypesForCategory('jobs'));
    expect(where).toMatchObject({
      recipientId: 'user-1',
      type: { in: notificationTypesForCategory('jobs') },
    });
  });

  it('keeps an equal timestamp inside one category on the next page', () => {
    const at = new Date('2026-11-08T12:00:00.000Z');
    const older = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: at,
      type: NotificationType.system,
    };
    const newer = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: at,
      type: NotificationType.system,
    };
    const first = sliceNotificationPage([older, newer], {
      take: 1,
      cursor: null,
      types: notificationTypesForCategory('platform_updates'),
    });
    expect(first.map((row) => row.id)).toEqual([newer.id]);
    const second = sliceNotificationPage([older, newer], {
      take: 1,
      cursor: { createdAt: at.toISOString(), id: newer.id },
      types: notificationTypesForCategory('platform_updates'),
    });
    expect(second.map((row) => row.id)).toEqual([older.id]);
  });
});
