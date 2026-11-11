import { BadRequestException } from '@nestjs/common';
import { DisputeCaseStatus, Prisma } from '@prisma/client';
import {
  createdPageWhere,
  decodeCursor,
  isUuid,
  optionalCursor,
  optionalLookup,
  parseEnumList,
  parsePageLimit,
  textMatch,
  type PageCursor,
} from './admin-read.query';

const STATUSES = ['open', 'in_review', 'closed'] as const;
const ASSIGNMENTS = ['unassigned', 'mine', 'others'] as const;
const ENGAGEMENT_STATES = ['disputed', 'not_disputed'] as const;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{16,128}$/;
const ACTIONS = ['start_review', 'close', 'reopen'] as const;
const OUTCOMES = [
  'parties_resolved',
  'no_staff_action',
  'payment_follow_up',
  'invalid_or_duplicate',
  'other',
] as const;

export type DisputeCaseListInput = {
  limit: number;
  cursor: PageCursor | null;
  q: string | null;
  status: Array<(typeof STATUSES)[number]> | null;
  assignment: Array<(typeof ASSIGNMENTS)[number]> | null;
  engagementState: Array<(typeof ENGAGEMENT_STATES)[number]> | null;
  staffMemberId: string;
};

export function disputeCaseListQuery(
  query: Record<string, unknown>,
  staffMemberId: string,
): DisputeCaseListInput {
  return {
    limit: parsePageLimit(query.limit),
    cursor: decodeCursor(optionalCursor(query.cursor)),
    q: optionalLookup(query.q, 'Enter a name or record id.'),
    status: parseEnumList(query.status, STATUSES, 'case status'),
    assignment: parseEnumList(query.assignment, ASSIGNMENTS, 'assignment'),
    engagementState: parseEnumList(query.engagementState, ENGAGEMENT_STATES, 'engagement state'),
    staffMemberId,
  };
}

export function disputeCaseWhere(input: DisputeCaseListInput): Prisma.DisputeCaseWhereInput {
  const groups: Prisma.DisputeCaseWhereInput[] = [];
  if (input.q) {
    const matches: Prisma.DisputeCaseWhereInput[] = [
      { engagement: { title: textMatch(input.q) } },
      { engagement: { client: { displayName: textMatch(input.q) } } },
      { engagement: { provider: { displayName: textMatch(input.q) } } },
      {
        engagement: {
          invoices: { some: { invoiceNumber: { equals: input.q, mode: 'insensitive' } } },
        },
      },
    ];
    if (isUuid(input.q)) {
      matches.push(
        { id: input.q },
        { engagementId: input.q },
        { engagement: { clientId: input.q } },
        { engagement: { providerId: input.q } },
        { engagement: { payments: { some: { id: input.q } } } },
      );
    }
    groups.push({ OR: matches });
  }
  if (input.status) groups.push({ status: { in: input.status } });
  if (input.assignment) {
    groups.push({
      OR: input.assignment.map((value) => {
        if (value === 'unassigned') return { assigneeStaffMemberId: null };
        if (value === 'mine') return { assigneeStaffMemberId: input.staffMemberId };
        return {
          AND: [
            { assigneeStaffMemberId: { not: null } },
            { NOT: { assigneeStaffMemberId: input.staffMemberId } },
          ],
        };
      }),
    });
  }
  if (input.engagementState) {
    groups.push({
      OR: input.engagementState.map((value) =>
        value === 'disputed'
          ? { isLatest: true, engagement: { status: 'disputed' as const } }
          : { OR: [{ isLatest: false }, { engagement: { status: { not: 'disputed' } } }] },
      ),
    });
  }
  return groups.length === 0 ? {} : { AND: groups };
}

export function disputeCasePageWhere(input: DisputeCaseListInput) {
  return createdPageWhere(disputeCaseWhere(input) as Record<string, unknown>, input.cursor);
}

export function openCaseWhere(): Prisma.DisputeCaseWhereInput {
  return { status: { in: [DisputeCaseStatus.open, DisputeCaseStatus.in_review] } };
}

export function disputedEngagementCaseWhere(): Prisma.DisputeCaseWhereInput {
  return { isLatest: true, engagement: { status: 'disputed' } };
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new BadRequestException(`${label} is required.`);
  const text = value.trim();
  if (text.length < 1 || text.length > max) throw new BadRequestException(`${label} is required.`);
  return text;
}

function requiredRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException('The case revision is not valid.');
  }
  return value;
}

export function requiredIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY.test(value)) {
    throw new BadRequestException('The request key is not valid.');
  }
  return value;
}

export function parseStatusBody(body: Record<string, unknown>) {
  const action = body.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    throw new BadRequestException('That case action is not valid.');
  }
  const outcomeValue = body.outcome;
  if (action === 'close') {
    if (typeof outcomeValue !== 'string' || !OUTCOMES.includes(outcomeValue as (typeof OUTCOMES)[number])) {
      throw new BadRequestException('Choose a case outcome.');
    }
  } else if (outcomeValue !== undefined && outcomeValue !== null) {
    throw new BadRequestException('An outcome is only used when closing a case.');
  }
  return {
    action: action as (typeof ACTIONS)[number],
    outcome: action === 'close' ? (outcomeValue as (typeof OUTCOMES)[number]) : null,
    note: requiredText(body.note, 'A note', 500),
    expectedRevision: requiredRevision(body.expectedRevision),
    idempotencyKey: requiredIdempotencyKey(body.idempotencyKey),
  };
}

export function parseAssignmentBody(body: Record<string, unknown>) {
  const assignee = body.assigneeStaffMemberId;
  if (assignee !== null && (typeof assignee !== 'string' || !isUuid(assignee))) {
    throw new BadRequestException('Choose an operator or clear the assignment.');
  }
  return {
    assigneeStaffMemberId: assignee,
    note: requiredText(body.note, 'A note', 500),
    expectedRevision: requiredRevision(body.expectedRevision),
    idempotencyKey: requiredIdempotencyKey(body.idempotencyKey),
  };
}

export function parseNoteBody(body: Record<string, unknown>) {
  return {
    body: requiredText(body.body, 'A note', 2000),
    idempotencyKey: requiredIdempotencyKey(body.idempotencyKey),
  };
}

const RESOLUTION_ACTIONS = ['return_to_client_review', 'further_work', 'follow_up'] as const;

export function parseResolutionBody(body: Record<string, unknown>) {
  const action = body.action;
  if (typeof action !== 'string' || !RESOLUTION_ACTIONS.includes(action as (typeof RESOLUTION_ACTIONS)[number])) {
    throw new BadRequestException('That resolution action is not valid.');
  }
  if (body.expectedEngagementStatus !== 'disputed') {
    throw new BadRequestException('The engagement status confirmation is not valid.');
  }
  return {
    action: action as (typeof RESOLUTION_ACTIONS)[number],
    note: requiredText(body.note, 'A note', 500),
    expectedRevision: requiredRevision(body.expectedRevision),
    expectedEngagementStatus: 'disputed' as const,
    idempotencyKey: requiredIdempotencyKey(body.idempotencyKey),
  };
}
