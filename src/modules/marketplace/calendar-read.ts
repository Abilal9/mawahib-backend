import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  WorkEngagementStatus,
  type EngagementScheduleKind,
  type EngagementScheduleSource,
} from '@prisma/client';
import type {
  CalendarCounterpartDto,
  CalendarResponseDto,
  CalendarScheduledItemDto,
  CalendarUnscheduledItemDto,
  EngagementScheduleResponseDto,
} from './dto/calendar.dto';
import { isoFromUtcDate, utcDateFromIso } from './engagement-schedule';
import { isIsoDate } from './work-request-terms';

/** Inclusive civil-day cap. A month view, plus a short overlap on each side. */
export const CALENDAR_RANGE_MAX_DAYS = 93;

/** One extra row is fetched so the response can set `scheduledHasMore`. */
export const CALENDAR_SCHEDULED_LIMIT = 200;

/** Active work with no date. Not a page of history. */
export const CALENDAR_UNSCHEDULED_LIMIT = 50;

export const CALENDAR_SCHEDULED_STATUSES = [
  WorkEngagementStatus.pending_payment,
  WorkEngagementStatus.payment_failed,
  WorkEngagementStatus.in_progress,
  WorkEngagementStatus.delivered,
  WorkEngagementStatus.disputed,
  WorkEngagementStatus.completed,
] as const;

export const CALENDAR_UNSCHEDULED_STATUSES = [
  WorkEngagementStatus.pending_payment,
  WorkEngagementStatus.payment_failed,
  WorkEngagementStatus.in_progress,
  WorkEngagementStatus.delivered,
  WorkEngagementStatus.disputed,
] as const;

const TENTATIVE_STATUSES = new Set<WorkEngagementStatus>([
  WorkEngagementStatus.pending_payment,
  WorkEngagementStatus.payment_failed,
]);

export type CalendarPartyRow = {
  id: string;
  displayName: string;
  username: string;
  isVerified: boolean;
  profile: { avatarUrl: string | null } | null;
};

export type CalendarWorkRequestLink = {
  id: string;
  deletedAt: Date | null;
} | null;

export type CalendarScheduleRow = {
  kind: EngagementScheduleKind;
  startDate: Date;
  endDate: Date;
  source: EngagementScheduleSource;
  engagement: {
    id: string;
    title: string;
    status: WorkEngagementStatus;
    clientId: string;
    providerId: string;
    client: CalendarPartyRow;
    provider: CalendarPartyRow;
    workRequest: CalendarWorkRequestLink;
  };
};

export type CalendarUnscheduledRow = {
  id: string;
  title: string;
  status: WorkEngagementStatus;
  clientId: string;
  providerId: string;
  createdAt: Date;
  client: CalendarPartyRow;
  provider: CalendarPartyRow;
  workRequest: CalendarWorkRequestLink;
};

export type EngagementScheduleStateRow = {
  id: string;
  status: WorkEngagementStatus;
  clientId: string;
  providerId: string;
  schedule: {
    kind: EngagementScheduleKind;
    startDate: Date;
    endDate: Date;
    source: EngagementScheduleSource;
  } | null;
};

export type CalendarScheduleQuery = {
  userId: string;
  from: Date;
  to: Date;
};

export type CalendarUnscheduledQuery = {
  userId: string;
};

/** Inclusive overlap on civil dates. `YYYY-MM-DD` compares in calendar order. */
export function civilDatesOverlap(
  start: string,
  end: string,
  from: string,
  to: string,
): boolean {
  return start <= to && end >= from;
}

export function inclusiveCivilDaySpan(from: string, to: string): number {
  return (
    (utcDateFromIso(to).getTime() - utcDateFromIso(from).getTime()) /
      86_400_000 +
    1
  );
}

export function assertCalendarRange(
  from: string,
  to: string,
): { from: Date; to: Date } {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new BadRequestException(
      'from and to must be real dates (YYYY-MM-DD)',
    );
  }
  if (from > to) {
    throw new BadRequestException('from must not be after to');
  }
  if (inclusiveCivilDaySpan(from, to) > CALENDAR_RANGE_MAX_DAYS) {
    throw new BadRequestException(
      `Calendar range cannot exceed ${CALENDAR_RANGE_MAX_DAYS} days`,
    );
  }
  return { from: utcDateFromIso(from), to: utcDateFromIso(to) };
}

export function isTentativeStatus(status: WorkEngagementStatus): boolean {
  return TENTATIVE_STATUSES.has(status);
}

function linkedWorkRequestId(request: CalendarWorkRequestLink): string | null {
  if (!request || request.deletedAt) return null;
  return request.id;
}

function assertParty(clientId: string, providerId: string, userId: string) {
  if (clientId !== userId && providerId !== userId) {
    throw new ForbiddenException('You are not a party to this engagement');
  }
}

function counterpartOf(
  client: CalendarPartyRow,
  provider: CalendarPartyRow,
  clientId: string,
  userId: string,
): CalendarCounterpartDto {
  const party = clientId === userId ? provider : client;
  return {
    id: party.id,
    displayName: party.displayName,
    username: party.username,
    avatarUrl: party.profile?.avatarUrl ?? null,
    isVerified: party.isVerified,
  };
}

function unscheduledItem(
  input: {
    id: string;
    title: string;
    status: WorkEngagementStatus;
    clientId: string;
    providerId: string;
    client: CalendarPartyRow;
    provider: CalendarPartyRow;
    workRequest: CalendarWorkRequestLink;
  },
  userId: string,
): CalendarUnscheduledItemDto {
  assertParty(input.clientId, input.providerId, userId);
  return {
    engagementId: input.id,
    workRequestId: linkedWorkRequestId(input.workRequest),
    title: input.title,
    engagementStatus: input.status,
    tentative: isTentativeStatus(input.status),
    viewerRole: input.clientId === userId ? 'client' : 'provider',
    counterpart: counterpartOf(
      input.client,
      input.provider,
      input.clientId,
      userId,
    ),
  };
}

export function toUnscheduledItem(
  row: CalendarUnscheduledRow,
  userId: string,
): CalendarUnscheduledItemDto {
  return unscheduledItem(row, userId);
}

export function toScheduledItem(
  row: CalendarScheduleRow,
  userId: string,
): CalendarScheduledItemDto {
  return {
    ...unscheduledItem(row.engagement, userId),
    kind: row.kind,
    startDate: isoFromUtcDate(row.startDate),
    endDate: isoFromUtcDate(row.endDate),
    source: row.source,
  };
}

export function toScheduleResponse(
  row: EngagementScheduleStateRow,
): EngagementScheduleResponseDto {
  return {
    engagementId: row.id,
    engagementStatus: row.status,
    tentative: isTentativeStatus(row.status),
    schedule: row.schedule
      ? {
          kind: row.schedule.kind,
          startDate: isoFromUtcDate(row.schedule.startDate),
          endDate: isoFromUtcDate(row.schedule.endDate),
          source: row.schedule.source,
        }
      : null,
  };
}

export function calendarPage(input: {
  from: string;
  to: string;
  scheduledRows: CalendarScheduleRow[];
  unscheduledRows: CalendarUnscheduledRow[];
  userId: string;
}): CalendarResponseDto {
  return {
    from: input.from,
    to: input.to,
    scheduled: input.scheduledRows
      .slice(0, CALENDAR_SCHEDULED_LIMIT)
      .map((row) => toScheduledItem(row, input.userId)),
    scheduledHasMore: input.scheduledRows.length > CALENDAR_SCHEDULED_LIMIT,
    unscheduled: input.unscheduledRows
      .slice(0, CALENDAR_UNSCHEDULED_LIMIT)
      .map((row) => toUnscheduledItem(row, input.userId)),
    unscheduledHasMore:
      input.unscheduledRows.length > CALENDAR_UNSCHEDULED_LIMIT,
  };
}
