import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  EngagementScheduleKind,
  EngagementScheduleSource,
  WorkEngagementStatus,
} from '@prisma/client';
import { MediaService } from '../media/media.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TaxonomyFilterService } from '../taxonomy/taxonomy-filter.service';
import { ReviewClock } from '../reviews/review-clock';
import { ReviewsService } from '../reviews/reviews.service';
import { USER_REPOSITORY } from '../users/repositories/user.repository';
import {
  CALENDAR_RANGE_MAX_DAYS,
  CALENDAR_SCHEDULED_LIMIT,
  CALENDAR_SCHEDULED_STATUSES,
  CALENDAR_UNSCHEDULED_LIMIT,
  CALENDAR_UNSCHEDULED_STATUSES,
  assertCalendarRange,
  calendarPage,
  civilDatesOverlap,
  inclusiveCivilDaySpan,
  isTentativeStatus,
  toScheduleResponse,
  toScheduledItem,
  toUnscheduledItem,
  type CalendarPartyRow,
  type CalendarScheduleRow,
  type CalendarUnscheduledRow,
  type EngagementScheduleStateRow,
} from './calendar-read';
import { CalendarQueryDto } from './dto/calendar.dto';
import { isoFromUtcDate, utcDateFromIso } from './engagement-schedule';
import {
  EngagementsController,
  MyMarketplaceController,
} from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MARKETPLACE_REPOSITORY } from './repositories/marketplace.repository';
import { PrismaMarketplaceRepository } from './repositories/prisma-marketplace.repository';

const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const PROVIDER = '00000000-0000-4000-8000-0000000000a1';
const STRANGER = '00000000-0000-4000-8000-0000000000b1';
const ENGAGEMENT = '00000000-0000-4000-8000-0000000000e1';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

async function rejection(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return JSON.stringify((error as BadRequestException).getResponse());
  }
  throw new Error('expected a 400');
}

function party(id: string, name: string): CalendarPartyRow {
  return {
    id,
    displayName: name,
    username: name.toLowerCase(),
    isVerified: id === PROVIDER,
    profile: {
      avatarUrl: id === PROVIDER ? 'https://cdn.example/a.png' : null,
    },
  };
}

function scheduledRow(
  overrides: Partial<CalendarScheduleRow> & {
    engagement?: Partial<CalendarScheduleRow['engagement']>;
  } = {},
): CalendarScheduleRow {
  const { engagement, ...rest } = overrides;
  return {
    kind: EngagementScheduleKind.deadline,
    startDate: utcDateFromIso('2027-04-06'),
    endDate: utcDateFromIso('2027-04-06'),
    source: EngagementScheduleSource.agreed_terms,
    ...rest,
    engagement: {
      id: ENGAGEMENT,
      title: 'Brand film',
      status: WorkEngagementStatus.in_progress,
      clientId: CLIENT,
      providerId: PROVIDER,
      client: party(CLIENT, 'Najd'),
      provider: party(PROVIDER, 'Layla'),
      workRequest: {
        id: '00000000-0000-4000-8000-0000000000d1',
        deletedAt: null,
      },
      ...engagement,
    },
  };
}

function unscheduledRow(
  overrides: Partial<CalendarUnscheduledRow> = {},
): CalendarUnscheduledRow {
  return {
    id: ENGAGEMENT,
    title: 'Flexible edit',
    status: WorkEngagementStatus.pending_payment,
    clientId: CLIENT,
    providerId: PROVIDER,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    client: party(CLIENT, 'Najd'),
    provider: party(PROVIDER, 'Layla'),
    workRequest: {
      id: '00000000-0000-4000-8000-0000000000d2',
      deletedAt: null,
    },
    ...overrides,
  };
}

const FORBIDDEN_KEYS = [
  'email',
  'phone',
  'iban',
  'agreedTermsJson',
  'termsJson',
  'proposedTermsJson',
  'deadlineLabel',
  'dueAt',
  'notes',
  'proposalComment',
  'rejectionComment',
  'accountType',
  'listingId',
  'applicationId',
  'serviceOfferingId',
  'payments',
];

function assertPrivate(value: unknown) {
  const json = JSON.stringify(value);
  for (const key of FORBIDDEN_KEYS) {
    expect(json).not.toContain(`"${key}"`);
  }
  expect(json).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
}

describe('calendar civil dates', () => {
  it.each(['2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31'])(
    'serializes %s as a civil date',
    (iso) => {
      expect(isoFromUtcDate(utcDateFromIso(iso))).toBe(iso);
      const item = toScheduledItem(
        scheduledRow({
          startDate: utcDateFromIso(iso),
          endDate: utcDateFromIso(iso),
        }),
        CLIENT,
      );
      expect(item.startDate).toBe(iso);
      expect(item.endDate).toBe(iso);
      expect(JSON.stringify(item)).not.toContain('T00:00:00.000Z');
    },
  );

  it('counts an inclusive span in UTC days', () => {
    expect(inclusiveCivilDaySpan('2026-01-01', '2026-01-01')).toBe(1);
    expect(inclusiveCivilDaySpan('2026-01-01', '2026-04-03')).toBe(93);
    expect(inclusiveCivilDaySpan('2026-01-01', '2026-04-04')).toBe(94);
    expect(inclusiveCivilDaySpan('2026-03-01', '2026-06-01')).toBe(93);
    expect(inclusiveCivilDaySpan('2024-02-28', '2024-02-29')).toBe(2);
  });

  it('accepts the 93-day cap and rejects a longer or reversed window', () => {
    const accepted = assertCalendarRange('2026-01-01', '2026-04-03');
    expect(isoFromUtcDate(accepted.from)).toBe('2026-01-01');
    expect(isoFromUtcDate(accepted.to)).toBe('2026-04-03');
    expect(accepted.from).toEqual(utcDateFromIso('2026-01-01'));

    expect(() => assertCalendarRange('2026-04-04', '2026-01-01')).toThrow(
      BadRequestException,
    );
    expect(() => assertCalendarRange('2026-01-01', '2026-04-04')).toThrow(
      /cannot exceed 93 days/,
    );
    expect(() => assertCalendarRange('2026-02-29', '2026-03-01')).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['2027-04-06', '2027-04-06', true],
    ['2027-04-01', '2027-04-01', false],
    ['2027-04-01', '2027-04-05', true],
    ['2027-04-07', '2027-04-10', true],
    ['2027-04-01', '2027-04-10', true],
    ['2027-04-08', '2027-04-10', false],
    ['2027-04-05', '2027-04-05', true],
    ['2027-04-07', '2027-04-07', true],
  ])('overlap %s..%s is %s', (start, end, expected) => {
    expect(civilDatesOverlap(start, end, '2027-04-05', '2027-04-07')).toBe(
      expected,
    );
  });
});

describe('calendar query pipe', () => {
  const query = { type: 'query' as const, metatype: CalendarQueryDto };

  it('keeps a valid window as civil-date strings', async () => {
    const dto = await pipe.transform(
      { from: '2024-02-29', to: '2024-03-01' },
      query,
    );
    expect(dto.from).toBe('2024-02-29');
    expect(dto.to).toBe('2024-03-01');
    expect(dto.from).not.toBeInstanceOf(Date);
  });

  it.each([
    [{ to: '2026-01-02' }, 'from'],
    [{ from: '2026-01-01' }, 'to'],
    [{}, 'from'],
    [{ from: '2026-02-29', to: '2026-03-01' }, 'real date'],
    [{ from: '2026-13-01', to: '2026-13-02' }, 'real date'],
    [{ from: '2026-00-10', to: '2026-01-10' }, 'real date'],
    [{ from: '2026-01-32', to: '2026-02-01' }, 'real date'],
    [{ from: '01-01-2026', to: '2026-01-02' }, 'real date'],
    [{ from: '2026/01/01', to: '2026-01-02' }, 'real date'],
    [{ from: ['2026-01-01'], to: '2026-01-02' }, 'from'],
    [{ 'from[]': '2026-01-01', to: '2026-01-02' }, 'from'],
    [
      { from: '2026-01-01', to: '2026-01-02', includeCancelled: 'true' },
      'includeCancelled',
    ],
  ])('rejects %j', async (payload, fragment) => {
    const body = await rejection(pipe.transform(payload, query));
    expect(body).toContain(fragment);
  });
});

describe('calendar item mapping', () => {
  it('returns one item for a multi-day range and keeps the viewer and counterpart', () => {
    const row = scheduledRow({
      kind: EngagementScheduleKind.deadline_range,
      startDate: utcDateFromIso('2027-04-01'),
      endDate: utcDateFromIso('2027-04-10'),
      source: EngagementScheduleSource.agreed_terms,
    });
    const clientView = toScheduledItem(row, CLIENT);
    const providerView = toScheduledItem(row, PROVIDER);

    expect(clientView.viewerRole).toBe('client');
    expect(clientView.counterpart).toEqual({
      id: PROVIDER,
      displayName: 'Layla',
      username: 'layla',
      avatarUrl: 'https://cdn.example/a.png',
      isVerified: true,
    });
    expect(providerView.viewerRole).toBe('provider');
    expect(providerView.counterpart.id).toBe(CLIENT);
    expect(providerView.counterpart.id).not.toBe(PROVIDER);
    expect(clientView.startDate).toBe('2027-04-01');
    expect(clientView.endDate).toBe('2027-04-10');
    expect(clientView.kind).toBe(EngagementScheduleKind.deadline_range);
    expect(clientView.workRequestId).toBe(row.engagement.workRequest?.id);
    expect([clientView].length).toBe(1);
    assertPrivate(clientView);
    expect(Object.keys(clientView.counterpart).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'id',
      'isVerified',
      'username',
    ]);
  });

  it('nulls a missing or soft-deleted work request and marks payment states tentative', () => {
    const missing = toScheduledItem(
      scheduledRow({
        engagement: {
          status: WorkEngagementStatus.pending_payment,
          workRequest: null,
        },
      }),
      CLIENT,
    );
    const deleted = toUnscheduledItem(
      unscheduledRow({
        status: WorkEngagementStatus.payment_failed,
        workRequest: {
          id: 'gone',
          deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
      PROVIDER,
    );
    expect(missing.workRequestId).toBeNull();
    expect(missing.tentative).toBe(true);
    expect(missing.engagementStatus).toBe(WorkEngagementStatus.pending_payment);
    expect(deleted.workRequestId).toBeNull();
    expect(deleted.tentative).toBe(true);
    expect(deleted).not.toHaveProperty('startDate');
    expect(deleted).not.toHaveProperty('source');
    assertPrivate(deleted);
  });

  it('does not mark active or finished work tentative', () => {
    for (const status of [
      WorkEngagementStatus.in_progress,
      WorkEngagementStatus.delivered,
      WorkEngagementStatus.disputed,
      WorkEngagementStatus.completed,
      WorkEngagementStatus.cancelled,
    ]) {
      expect(isTentativeStatus(status)).toBe(false);
    }
    expect(isTentativeStatus(WorkEngagementStatus.pending_payment)).toBe(true);
    expect(isTentativeStatus(WorkEngagementStatus.payment_failed)).toBe(true);
  });

  it('refuses to map a row for someone who is not a party', () => {
    expect(() => toScheduledItem(scheduledRow(), STRANGER)).toThrow(
      ForbiddenException,
    );
  });

  it('returns a null schedule for unscheduled work and keeps a cancelled schedule', () => {
    const open: EngagementScheduleStateRow = {
      id: ENGAGEMENT,
      status: WorkEngagementStatus.pending_payment,
      clientId: CLIENT,
      providerId: PROVIDER,
      schedule: null,
    };
    const cancelled: EngagementScheduleStateRow = {
      id: ENGAGEMENT,
      status: WorkEngagementStatus.cancelled,
      clientId: CLIENT,
      providerId: PROVIDER,
      schedule: {
        kind: EngagementScheduleKind.deadline,
        startDate: utcDateFromIso('2026-12-31'),
        endDate: utcDateFromIso('2026-12-31'),
        source: EngagementScheduleSource.resolved_duration,
      },
    };
    const openBody = toScheduleResponse(open);
    const cancelledBody = toScheduleResponse(cancelled);
    expect(openBody.schedule).toBeNull();
    expect(openBody.tentative).toBe(true);
    expect(cancelledBody.schedule).toEqual({
      kind: EngagementScheduleKind.deadline,
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      source: EngagementScheduleSource.resolved_duration,
    });
    expect(cancelledBody).not.toHaveProperty('viewerRole');
    expect(cancelledBody).not.toHaveProperty('counterpart');
    expect(cancelledBody).not.toHaveProperty('workRequestId');
    assertPrivate(cancelledBody);
  });

  it('caps each collection and preserves repository order', () => {
    const scheduled = Array.from(
      { length: CALENDAR_SCHEDULED_LIMIT + 1 },
      (_, index) =>
        scheduledRow({
          startDate: utcDateFromIso('2027-04-06'),
          endDate: utcDateFromIso(
            index % 2 === 0 ? '2027-04-06' : '2027-04-07',
          ),
          engagement: { id: `eng-${index.toString().padStart(3, '0')}` },
        }),
    );
    const unscheduled = Array.from(
      { length: CALENDAR_UNSCHEDULED_LIMIT + 1 },
      (_, index) =>
        unscheduledRow({
          id: `open-${index.toString().padStart(3, '0')}`,
          createdAt: new Date(Date.UTC(2026, 9, 20, 0, 0, index)),
        }),
    );
    const page = calendarPage({
      from: '2027-04-05',
      to: '2027-04-07',
      scheduledRows: scheduled,
      unscheduledRows: unscheduled,
      userId: CLIENT,
    });
    expect(page.scheduled).toHaveLength(CALENDAR_SCHEDULED_LIMIT);
    expect(page.scheduledHasMore).toBe(true);
    expect(page.scheduled[0]?.engagementId).toBe('eng-000');
    expect(page.scheduled.at(-1)?.engagementId).toBe('eng-199');
    expect(page.unscheduled).toHaveLength(CALENDAR_UNSCHEDULED_LIMIT);
    expect(page.unscheduledHasMore).toBe(true);
    expect(page.unscheduled[0]?.engagementId).toBe('open-000');
    expect(page.from).toBe('2027-04-05');
    expect(page.to).toBe('2027-04-07');
  });
});

describe('calendar status policy', () => {
  const hidden = [
    WorkEngagementStatus.cancelled,
    WorkEngagementStatus.declined,
    WorkEngagementStatus.requested,
    WorkEngagementStatus.accepted,
  ];

  it('shows dated history, including completed, and hides cancelled', () => {
    expect(CALENDAR_SCHEDULED_STATUSES).toEqual([
      WorkEngagementStatus.pending_payment,
      WorkEngagementStatus.payment_failed,
      WorkEngagementStatus.in_progress,
      WorkEngagementStatus.delivered,
      WorkEngagementStatus.disputed,
      WorkEngagementStatus.completed,
    ]);
    for (const status of hidden) {
      expect(CALENDAR_SCHEDULED_STATUSES).not.toContain(status);
    }
  });

  it('keeps active undated work and omits completed or cancelled undated work', () => {
    expect(CALENDAR_UNSCHEDULED_STATUSES).toEqual([
      WorkEngagementStatus.pending_payment,
      WorkEngagementStatus.payment_failed,
      WorkEngagementStatus.in_progress,
      WorkEngagementStatus.delivered,
      WorkEngagementStatus.disputed,
    ]);
    expect(CALENDAR_UNSCHEDULED_STATUSES).not.toContain(
      WorkEngagementStatus.completed,
    );
    for (const status of hidden) {
      expect(CALENDAR_UNSCHEDULED_STATUSES).not.toContain(status);
    }
    expect(CALENDAR_RANGE_MAX_DAYS).toBe(93);
  });
});

describe('MarketplaceService calendar reads', () => {
  const marketplace = {
    listCalendarSchedules: jest.fn(),
    listUnscheduledCalendarEngagements: jest.fn(),
    findEngagementScheduleState: jest.fn(),
    findEngagementById: jest.fn(),
    listEngagementsForUser: jest.fn(),
  };
  let service: MarketplaceService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: MARKETPLACE_REPOSITORY, useValue: marketplace },
        { provide: USER_REPOSITORY, useValue: {} },
        { provide: MessagingService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MediaService, useValue: {} },
        { provide: TaxonomyFilterService, useValue: {} },
        { provide: ReviewsService, useValue: {} },
        { provide: ReviewClock, useValue: { now: () => new Date() } },
      ],
    }).compile();
    service = module.get(MarketplaceService);
  });

  it('queries both collections for the authenticated user and does not load full engagements', async () => {
    const dated = scheduledRow({
      source: EngagementScheduleSource.resolved_duration,
      engagement: { status: WorkEngagementStatus.completed },
    });
    const flexible = unscheduledRow({
      id: '00000000-0000-4000-8000-0000000000e2',
      status: WorkEngagementStatus.pending_payment,
    });
    marketplace.listCalendarSchedules.mockResolvedValue([dated]);
    marketplace.listUnscheduledCalendarEngagements.mockResolvedValue([
      flexible,
    ]);

    const page = await service.getMyCalendar(CLIENT, {
      from: '2027-04-05',
      to: '2027-04-07',
    });

    expect(marketplace.listCalendarSchedules).toHaveBeenCalledWith({
      userId: CLIENT,
      from: utcDateFromIso('2027-04-05'),
      to: utcDateFromIso('2027-04-07'),
    });
    expect(marketplace.listUnscheduledCalendarEngagements).toHaveBeenCalledWith(
      {
        userId: CLIENT,
      },
    );
    expect(marketplace.findEngagementById).not.toHaveBeenCalled();
    expect(marketplace.listEngagementsForUser).not.toHaveBeenCalled();
    expect(page.scheduled.map((item) => item.engagementId)).toEqual([
      ENGAGEMENT,
    ]);
    expect(page.unscheduled.map((item) => item.engagementId)).toEqual([
      flexible.id,
    ]);
    expect(page.scheduled[0]?.source).toBe(
      EngagementScheduleSource.resolved_duration,
    );
    expect(page.scheduled[0]?.tentative).toBe(false);
    expect(page.unscheduled[0]?.tentative).toBe(true);
    expect(page.scheduledHasMore).toBe(false);
    expect(page.unscheduledHasMore).toBe(false);
  });

  it('scopes a provider view to that user id', async () => {
    marketplace.listCalendarSchedules.mockResolvedValue([scheduledRow()]);
    marketplace.listUnscheduledCalendarEngagements.mockResolvedValue([]);
    const page = await service.getMyCalendar(PROVIDER, {
      from: '2027-04-06',
      to: '2027-04-06',
    });
    expect(marketplace.listCalendarSchedules).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PROVIDER }),
    );
    expect(page.scheduled[0]?.viewerRole).toBe('provider');
    expect(page.scheduled[0]?.counterpart.id).toBe(CLIENT);
  });

  it('returns an empty calendar when the repository finds no party rows', async () => {
    marketplace.listCalendarSchedules.mockResolvedValue([]);
    marketplace.listUnscheduledCalendarEngagements.mockResolvedValue([]);
    const page = await service.getMyCalendar(STRANGER, {
      from: '2027-04-05',
      to: '2027-04-07',
    });
    expect(page.scheduled).toEqual([]);
    expect(page.unscheduled).toEqual([]);
    expect(marketplace.listCalendarSchedules).toHaveBeenCalledWith(
      expect.objectContaining({ userId: STRANGER }),
    );
  });

  it('rejects a reversed window and a window past the cap before querying', async () => {
    await expect(
      service.getMyCalendar(CLIENT, { from: '2027-04-08', to: '2027-04-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getMyCalendar(CLIENT, { from: '2026-01-01', to: '2026-04-04' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(marketplace.listCalendarSchedules).not.toHaveBeenCalled();
  });

  it('returns 200 with a null schedule for a party engagement that has no date', async () => {
    marketplace.findEngagementScheduleState.mockResolvedValue({
      id: ENGAGEMENT,
      status: WorkEngagementStatus.in_progress,
      clientId: CLIENT,
      providerId: PROVIDER,
      schedule: null,
    });
    const body = await service.getEngagementSchedule(PROVIDER, ENGAGEMENT);
    expect(body.schedule).toBeNull();
    expect(body.engagementStatus).toBe(WorkEngagementStatus.in_progress);
    expect(marketplace.findEngagementById).not.toHaveBeenCalled();
  });

  it('returns a cancelled schedule to a party', async () => {
    marketplace.findEngagementScheduleState.mockResolvedValue({
      id: ENGAGEMENT,
      status: WorkEngagementStatus.cancelled,
      clientId: CLIENT,
      providerId: PROVIDER,
      schedule: {
        kind: EngagementScheduleKind.deadline,
        startDate: utcDateFromIso('2026-01-01'),
        endDate: utcDateFromIso('2026-01-01'),
        source: EngagementScheduleSource.agreed_terms,
      },
    });
    const body = await service.getEngagementSchedule(CLIENT, ENGAGEMENT);
    expect(body.engagementStatus).toBe(WorkEngagementStatus.cancelled);
    expect(body.schedule?.startDate).toBe('2026-01-01');
  });

  it('uses the same not-found error for a missing engagement and forbids a stranger', async () => {
    marketplace.findEngagementScheduleState.mockResolvedValue(null);
    await expect(
      service.getEngagementSchedule(CLIENT, ENGAGEMENT),
    ).rejects.toThrow(new NotFoundException('Engagement not found'));

    marketplace.findEngagementScheduleState.mockResolvedValue({
      id: ENGAGEMENT,
      status: WorkEngagementStatus.in_progress,
      clientId: CLIENT,
      providerId: PROVIDER,
      schedule: null,
    });
    await expect(
      service.getEngagementSchedule(STRANGER, ENGAGEMENT),
    ).rejects.toThrow(
      new ForbiddenException('You are not a party to this engagement'),
    );
  });
});

describe('calendar repository predicates', () => {
  const engagementSchedule = { findMany: jest.fn().mockResolvedValue([]) };
  const workEngagement = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const repo = new PrismaMarketplaceRepository({
    engagementSchedule,
    workEngagement,
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overlaps inclusive dates for one party and hides deleted or cancelled work', async () => {
    const from = utcDateFromIso('2027-04-05');
    const to = utcDateFromIso('2027-04-07');
    await repo.listCalendarSchedules({ userId: CLIENT, from, to });
    const args = engagementSchedule.findMany.mock.calls[0][0];
    expect(args.where.startDate).toEqual({ lte: to });
    expect(args.where.endDate).toEqual({ gte: from });
    expect(args.where.engagement.deletedAt).toBeNull();
    expect(args.where.engagement.status.in).toEqual([
      ...CALENDAR_SCHEDULED_STATUSES,
    ]);
    expect(args.where.engagement.OR).toEqual([
      { clientId: CLIENT },
      { providerId: CLIENT },
    ]);
    expect(args.orderBy).toEqual([
      { startDate: 'asc' },
      { endDate: 'asc' },
      { engagementId: 'asc' },
    ]);
    expect(args.take).toBe(CALENDAR_SCHEDULED_LIMIT + 1);
    expect(args.select.engagement.select.workRequest).toEqual({
      select: { id: true, deletedAt: true },
    });
    expect(JSON.stringify(args.select)).not.toContain('email');
    expect(JSON.stringify(args.select)).not.toContain('agreedTermsJson');
    expect(JSON.stringify(args.select)).not.toContain('deadlineLabel');
    expect(JSON.stringify(args.select)).not.toContain('dueAt');
    expect(args.select.engagement.select).not.toHaveProperty('payments');
  });

  it('bounds active undated work independently of the window', async () => {
    await repo.listUnscheduledCalendarEngagements({ userId: PROVIDER });
    const args = workEngagement.findMany.mock.calls[0][0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.schedule).toEqual({ is: null });
    expect(args.where.status.in).toEqual([...CALENDAR_UNSCHEDULED_STATUSES]);
    expect(args.where.OR).toEqual([
      { clientId: PROVIDER },
      { providerId: PROVIDER },
    ]);
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.orderBy).not.toContainEqual(
      expect.objectContaining({ updatedAt: expect.anything() }),
    );
    expect(args.take).toBe(CALENDAR_UNSCHEDULED_LIMIT + 1);
    expect(args.where).not.toHaveProperty('startDate');
  });

  it('loads one engagement schedule without the full engagement graph', async () => {
    await repo.findEngagementScheduleState(ENGAGEMENT);
    const args = workEngagement.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: ENGAGEMENT, deletedAt: null });
    expect(args.select.schedule.select).toEqual({
      kind: true,
      startDate: true,
      endDate: true,
      source: true,
    });
    expect(args).not.toHaveProperty('include');
    expect(args.select).not.toHaveProperty('client');
    expect(args.select).not.toHaveProperty('workRequest');
  });
});

describe('calendar controllers', () => {
  it('passes the authenticated user into both reads', async () => {
    const marketplace = {
      getMyCalendar: jest.fn().mockResolvedValue({ from: '2026-01-01' }),
      getEngagementSchedule: jest.fn().mockResolvedValue({ schedule: null }),
    } as unknown as MarketplaceService;
    const mine = new MyMarketplaceController(marketplace);
    const engagements = new EngagementsController(marketplace);
    await mine.calendar({ sub: CLIENT } as never, {
      from: '2026-01-01',
      to: '2026-01-31',
    });
    await engagements.schedule({ sub: PROVIDER } as never, ENGAGEMENT);
    expect(marketplace.getMyCalendar).toHaveBeenCalledWith(CLIENT, {
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(marketplace.getEngagementSchedule).toHaveBeenCalledWith(
      PROVIDER,
      ENGAGEMENT,
    );
  });

  it('rejects a malformed engagement id before a lookup', async () => {
    const uuidPipe = new ParseUUIDPipe();
    await expect(
      uuidPipe.transform('not-a-uuid', { type: 'param', data: 'id' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      uuidPipe.transform(ENGAGEMENT, { type: 'param', data: 'id' }),
    ).resolves.toBe(ENGAGEMENT);
  });
});
