import { BadRequestException } from '@nestjs/common';
import { WorkEngagementStatus } from '@prisma/client';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADMIN_PAGE_LIMIT = 20;
const MAX_QUERY = 200;

export type PageCursor = { at: string; id: string };

export function parsePageLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return ADMIN_PAGE_LIMIT;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > ADMIN_PAGE_LIMIT) {
    throw new BadRequestException('Page size must be from 1 to 20.');
  }
  return parsed;
}

export function optionalLookup(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter a name, email, username, or account id.');
  }
  const query = value.trim();
  if (!query) return null;
  if (query.length > MAX_QUERY) {
    throw new BadRequestException('Enter a name, email, username, or account id.');
  }
  return query;
}

export function requireLookup(value: unknown): string {
  const query = optionalLookup(value);
  if (!query) {
    throw new BadRequestException('Enter an email, username, or account id.');
  }
  return query;
}

export function optionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 300) {
    throw new BadRequestException('That page is not valid.');
  }
  return value;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(`${cursor.at}\n${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined): PageCursor | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('That page is not valid.');
  }
  const [at, id] = decoded.split('\n');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !isUuid(id)) {
    throw new BadRequestException('That page is not valid.');
  }
  return { at, id };
}

const visibleUsers = { deletedAt: null };

function contains(query: string) {
  const literal = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return { contains: literal, mode: 'insensitive' as const };
}

export function userFilter(query: string | null) {
  if (!query) return visibleUsers;
  const matches: Array<Record<string, unknown>> = [
    { displayName: contains(query) },
    { username: contains(query) },
    { email: contains(query) },
  ];
  if (isUuid(query)) matches.push({ id: query });
  return { AND: [visibleUsers, { OR: matches }] };
}

export function userPageWhere(query: string | null, cursor: PageCursor | null) {
  const match = userFilter(query);
  if (!cursor) return match;
  return {
    AND: [
      match,
      {
        OR: [
          { createdAt: { lt: new Date(cursor.at) } },
          { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

export function disputePageWhere(cursor: PageCursor | null) {
  const disputed = { status: WorkEngagementStatus.disputed };
  if (!cursor) return disputed;
  return {
    AND: [
      disputed,
      {
        OR: [
          { updatedAt: { lt: new Date(cursor.at) } },
          { updatedAt: new Date(cursor.at), id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

export const disputeEventQuery = {
  where: { toStatus: WorkEngagementStatus.disputed },
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  take: 1,
  select: {
    id: true,
    note: true,
    createdAt: true,
    toStatus: true,
  },
};

export const paymentSummaryQuery = {
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  take: 1,
  select: {
    amount: true,
    currency: true,
    status: true,
    provider: true,
  },
};
