import { BadRequestException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';

export type NotificationCursor = {
  createdAt: string;
  id: string;
};

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

/** Newest first. Equal timestamps stay ordered by id, so a page boundary cannot skip a row. */
export function notificationPageSize(take?: number): number {
  if (take === undefined) return PAGE_DEFAULT;
  if (!Number.isInteger(take) || take < 1 || take > PAGE_MAX) {
    throw new BadRequestException('Choose a page size from 1 to 50.');
  }
  return take;
}

export function encodeNotificationCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

export function decodeNotificationCursor(raw?: string): NotificationCursor | null {
  if (raw === undefined || raw === '') return null;
  let parsed: Partial<NotificationCursor>;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<NotificationCursor>;
  } catch {
    throw new BadRequestException('That notification page is no longer valid.');
  }
  if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
    throw new BadRequestException('That notification page is no longer valid.');
  }
  const createdAt = new Date(parsed.createdAt);
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) {
    throw new BadRequestException('That notification page is no longer valid.');
  }
  return { createdAt: parsed.createdAt, id: parsed.id };
}

/**
 * Keyset on (created_at DESC, id DESC).
 * notifications_recipient_id_created_at_idx already filters the recipient
 * and walks created_at. The id comparison only orders rows that share a timestamp.
 */
export function notificationKeyset(
  cursor: NotificationCursor | null,
): Prisma.NotificationWhereInput | undefined {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } },
    ],
  };
}

/** Category filter and keyset apply together, before `take`. */
export function notificationListWhere(
  recipientId: string,
  cursor: NotificationCursor | null,
  types?: NotificationType[] | null,
): Prisma.NotificationWhereInput {
  return {
    recipientId,
    ...(types ? { type: { in: types } } : {}),
    ...notificationKeyset(cursor),
  };
}

export type NotificationPageRow = {
  id: string;
  createdAt: Date;
  type: NotificationType;
};

/** Same order and boundary as the database keyset. Used to test paging without stored rows. */
export function sliceNotificationPage<T extends NotificationPageRow>(
  rows: T[],
  options: { take: number; cursor: NotificationCursor | null; types?: NotificationType[] | null },
): T[] {
  const cursorAt = options.cursor ? new Date(options.cursor.createdAt).getTime() : null;
  return rows
    .filter((row) => !options.types || options.types.includes(row.type))
    .filter((row) => {
      if (cursorAt === null || !options.cursor) return true;
      const at = row.createdAt.getTime();
      if (at < cursorAt) return true;
      if (at > cursorAt) return false;
      return row.id < options.cursor.id;
    })
    .sort((a, b) => {
      const at = b.createdAt.getTime() - a.createdAt.getTime();
      if (at !== 0) return at;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    })
    .slice(0, options.take);
}
