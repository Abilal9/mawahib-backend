import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
