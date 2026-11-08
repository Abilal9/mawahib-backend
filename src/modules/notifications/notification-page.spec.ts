import { BadRequestException } from '@nestjs/common';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  notificationKeyset,
  notificationPageSize,
} from './notification-page';

describe('notification pages', () => {
  it('walks older rows and keeps an equal timestamp ordered by id', () => {
    const where = notificationKeyset({
      createdAt: '2026-11-08T12:00:00.000Z',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(where).toEqual({
      OR: [
        { createdAt: { lt: new Date('2026-11-08T12:00:00.000Z') } },
        {
          createdAt: new Date('2026-11-08T12:00:00.000Z'),
          id: { lt: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        },
      ],
    });
  });

  it('rejects a cursor that is not a page token', () => {
    expect(() => decodeNotificationCursor('not-a-cursor')).toThrow(BadRequestException);
  });

  it('round-trips the last included row', () => {
    const at = new Date('2026-11-08T12:00:00.000Z');
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(decodeNotificationCursor(encodeNotificationCursor(at, id))).toEqual({
      createdAt: at.toISOString(),
      id,
    });
  });

  it('keeps the default page under the old 50-item ceiling', () => {
    expect(notificationPageSize(undefined)).toBe(20);
    expect(notificationPageSize(50)).toBe(50);
    expect(() => notificationPageSize(51)).toThrow(BadRequestException);
  });
});
