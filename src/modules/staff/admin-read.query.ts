import { BadRequestException } from '@nestjs/common';
import {
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  Prisma,
  ServiceOfferingStatus,
  WorkEngagementSource,
  WorkEngagementStatus,
} from '@prisma/client';

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

export function optionalLookup(
  value: unknown,
  invalidMessage = 'Enter a name, email, username, or account id.',
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(invalidMessage);
  }
  const query = value.trim();
  if (!query) return null;
  if (query.length > MAX_QUERY) {
    throw new BadRequestException(invalidMessage);
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

const MARKETPLACE_LOOKUP = 'Enter a name or record id.';

export function parseIncludeDeleted(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException('includeDeleted must be true or false.');
}

export function parseEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T[] | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`Choose a valid ${label}.`);
  }
  const parts = value.split(',').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    throw new BadRequestException(`Choose a valid ${label}.`);
  }
  const unique = [...new Set(parts)];
  if (unique.length !== parts.length || unique.some((part) => !allowed.includes(part as T))) {
    throw new BadRequestException(`Choose a valid ${label}.`);
  }
  return unique as T[];
}

export function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value.trim())) {
    throw new BadRequestException(`${label} is not valid.`);
  }
  return value.trim();
}

export function createdPageWhere<T extends Record<string, unknown>>(
  match: T,
  cursor: PageCursor | null,
): T | { AND: Array<T | Record<string, unknown>> } {
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

export function textMatch(query: string) {
  const literal = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return { contains: literal, mode: 'insensitive' as const };
}

function deletedScope(includeDeleted: boolean) {
  return includeDeleted ? {} : { deletedAt: null };
}

export type MarketplaceListQuery = {
  limit: number;
  cursor: PageCursor | null;
  q: string | null;
  includeDeleted: boolean;
};

function sharedList(query: Record<string, unknown>): MarketplaceListQuery {
  return {
    limit: parsePageLimit(query.limit),
    cursor: decodeCursor(optionalCursor(query.cursor)),
    q: optionalLookup(query.q, MARKETPLACE_LOOKUP),
    includeDeleted: parseIncludeDeleted(query.includeDeleted),
  };
}

export function jobListQuery(query: Record<string, unknown>) {
  return {
    ...sharedList(query),
    status: parseEnumList(query.status, Object.values(JobListingStatus), 'job status'),
    employmentType: parseEnumList(
      query.employmentType,
      Object.values(EmploymentType),
      'employment type',
    ),
  };
}

export function serviceListQuery(query: Record<string, unknown>) {
  return {
    ...sharedList(query),
    status: parseEnumList(query.status, Object.values(ServiceOfferingStatus), 'service status'),
  };
}

export function applicationListQuery(query: Record<string, unknown>) {
  return {
    ...sharedList(query),
    status: parseEnumList(query.status, Object.values(JobApplicationStatus), 'application status'),
    listingId: optionalUuid(query.listingId, 'Listing'),
  };
}

export function engagementListQuery(query: Record<string, unknown>) {
  return {
    ...sharedList(query),
    status: parseEnumList(query.status, Object.values(WorkEngagementStatus), 'engagement status'),
    source: parseEnumList(query.source, Object.values(WorkEngagementSource), 'engagement source'),
    listingId: optionalUuid(query.listingId, 'Listing'),
    serviceOfferingId: optionalUuid(query.serviceOfferingId, 'Service'),
  };
}

export function jobWhere(input: ReturnType<typeof jobListQuery>): Prisma.JobListingWhereInput {
  const where: Prisma.JobListingWhereInput = deletedScope(input.includeDeleted);
  if (input.status) where.status = { in: input.status };
  if (input.employmentType) where.employmentType = { in: input.employmentType };
  if (input.q) {
    const text = textMatch(input.q);
    const or: Prisma.JobListingWhereInput[] = [
      { title: text },
      { companyName: text },
      { poster: { displayName: text } },
    ];
    if (isUuid(input.q)) or.push({ id: input.q });
    where.OR = or;
  }
  return where;
}

export function jobBaseWhere(includeDeleted: boolean): Prisma.JobListingWhereInput {
  return deletedScope(includeDeleted);
}

export function jobIsNarrow(input: ReturnType<typeof jobListQuery>): boolean {
  return Boolean(input.q || input.status || input.employmentType);
}

export function serviceWhere(
  input: ReturnType<typeof serviceListQuery>,
): Prisma.ServiceOfferingWhereInput {
  const where: Prisma.ServiceOfferingWhereInput = deletedScope(input.includeDeleted);
  if (input.status) where.status = { in: input.status };
  if (input.q) {
    const text = textMatch(input.q);
    const or: Prisma.ServiceOfferingWhereInput[] = [
      { title: text },
      { user: { displayName: text } },
    ];
    if (isUuid(input.q)) or.push({ id: input.q });
    where.OR = or;
  }
  return where;
}

export function serviceBaseWhere(includeDeleted: boolean): Prisma.ServiceOfferingWhereInput {
  return deletedScope(includeDeleted);
}

export function serviceIsNarrow(input: ReturnType<typeof serviceListQuery>): boolean {
  return Boolean(input.q || input.status);
}

export function applicationWhere(
  input: ReturnType<typeof applicationListQuery>,
): Prisma.JobApplicationWhereInput {
  const where: Prisma.JobApplicationWhereInput = deletedScope(input.includeDeleted);
  if (input.status) where.status = { in: input.status };
  if (input.listingId) where.listingId = input.listingId;
  if (input.q) {
    const text = textMatch(input.q);
    const or: Prisma.JobApplicationWhereInput[] = [
      { listing: { title: text } },
      { applicant: { displayName: text } },
      { listing: { poster: { displayName: text } } },
    ];
    if (isUuid(input.q)) or.push({ id: input.q });
    where.OR = or;
  }
  return where;
}

export function applicationBaseWhere(includeDeleted: boolean): Prisma.JobApplicationWhereInput {
  return deletedScope(includeDeleted);
}

export function applicationIsNarrow(input: ReturnType<typeof applicationListQuery>): boolean {
  return Boolean(input.q || input.status || input.listingId);
}

export function engagementWhere(
  input: ReturnType<typeof engagementListQuery>,
): Prisma.WorkEngagementWhereInput {
  const where: Prisma.WorkEngagementWhereInput = deletedScope(input.includeDeleted);
  if (input.status) where.status = { in: input.status };
  if (input.source) where.source = { in: input.source };
  if (input.listingId) where.listingId = input.listingId;
  if (input.serviceOfferingId) where.serviceOfferingId = input.serviceOfferingId;
  if (input.q) {
    const text = textMatch(input.q);
    const or: Prisma.WorkEngagementWhereInput[] = [
      { title: text },
      { client: { displayName: text } },
      { provider: { displayName: text } },
    ];
    if (isUuid(input.q)) or.push({ id: input.q });
    where.OR = or;
  }
  return where;
}

export function engagementBaseWhere(includeDeleted: boolean): Prisma.WorkEngagementWhereInput {
  return deletedScope(includeDeleted);
}

export function engagementIsNarrow(input: ReturnType<typeof engagementListQuery>): boolean {
  return Boolean(
    input.q || input.status || input.source || input.listingId || input.serviceOfferingId,
  );
}
