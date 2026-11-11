import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DisputeCaseStatus,
  Prisma,
  StaffMembershipStatus,
  StaffRole,
  WorkEngagementStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { encodeCursor, type PageCursor } from './admin-read.query';
import {
  disputeCaseListQuery,
  disputeCasePageWhere,
  disputeCaseWhere,
  disputedEngagementCaseWhere,
  openCaseWhere,
} from './dispute-case.query';
import { resolutionOptions, type ResolutionAction } from './dispute-resolution';

const STAFF_ACCESS_DENIED = 'STAFF_ACCESS_DENIED';

const listSelect = {
  id: true,
  status: true,
  revision: true,
  origin: true,
  createdAt: true,
  statusChangedAt: true,
  closedOutcome: true,
  isLatest: true,
  openedEvent: { select: { note: true } },
  engagement: {
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      client: { select: { id: true, displayName: true, accountStatus: true, deletedAt: true } },
      provider: { select: { id: true, displayName: true, accountStatus: true, deletedAt: true } },
    },
  },
  assignee: { select: { id: true, invitedEmail: true, status: true } },
} satisfies Prisma.DisputeCaseSelect;

type ListRow = Prisma.DisputeCaseGetPayload<{ select: typeof listSelect }>;

@Injectable()
export class DisputeCaseService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const [openCases, disputedEngagements, totalCases] = await Promise.all([
      this.prisma.disputeCase.count({ where: openCaseWhere() }),
      this.prisma.disputeCase.count({ where: disputedEngagementCaseWhere() }),
      this.prisma.disputeCase.count(),
    ]);
    return { openCases, disputedEngagements, totalCases };
  }

  async list(actor: { issuer: string; subjectId: string }, query: Record<string, unknown>) {
    const member = await this.prisma.staffMember.findUnique({
      where: { issuer_subjectId: { issuer: actor.issuer, subjectId: actor.subjectId } },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: STAFF_ACCESS_DENIED,
        message: 'Staff access is required.',
      });
    }
    const parsed = disputeCaseListQuery(query, member.id);
    const match = disputeCaseWhere(parsed);
    const [rows, matchCount, total] = await Promise.all([
      this.prisma.disputeCase.findMany({
        where: disputeCasePageWhere(parsed) as Prisma.DisputeCaseWhereInput,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: parsed.limit + 1,
        select: listSelect,
      }),
      this.prisma.disputeCase.count({ where: match }),
      this.prisma.disputeCase.count(),
    ]);
    const page = slice(rows, parsed.limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
    return {
      items: page.items.map((row) => toListItem(row, member.id)),
      nextCursor: page.nextCursor,
      total,
      matchCount,
    };
  }

  async detail(id: string, actor: { issuer: string; subjectId: string }) {
    const member = await this.prisma.staffMember.findUnique({
      where: { issuer_subjectId: { issuer: actor.issuer, subjectId: actor.subjectId } },
      select: { id: true, linkedProductUserId: true },
    });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: STAFF_ACCESS_DENIED,
        message: 'Staff access is required.',
      });
    }
    const row = await this.prisma.disputeCase.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Dispute case not found.');
    const otherCases = await this.prisma.disputeCase.findMany({
      where: { engagementId: row.engagementId, id: { not: row.id } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true, createdAt: true },
    });
    const assigneeIds = [
      ...new Set(
        row.events.flatMap((event) =>
          [event.previousAssigneeStaffMemberId, event.resultingAssigneeStaffMemberId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ),
    ];
    const knownStaff = assigneeIds.length
      ? await this.prisma.staffMember.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, invitedEmail: true },
        })
      : [];
    return toDetail(row, otherCases, member, knownStaff);
  }

  async assignees(id: string, actor: { issuer: string; subjectId: string }) {
    const [member, disputeCase] = await Promise.all([
      this.prisma.staffMember.findUnique({
        where: { issuer_subjectId: { issuer: actor.issuer, subjectId: actor.subjectId } },
        select: { id: true },
      }),
      this.prisma.disputeCase.findUnique({
        where: { id },
        select: { engagement: { select: { clientId: true, providerId: true } } },
      }),
    ]);
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: STAFF_ACCESS_DENIED,
        message: 'Staff access is required.',
      });
    }
    if (!disputeCase) throw new NotFoundException('Dispute case not found.');
    const operators = await this.prisma.staffMember.findMany({
      where: { status: StaffMembershipStatus.active, role: StaffRole.operator },
      orderBy: [{ invitedEmail: 'asc' }, { id: 'asc' }],
      select: { id: true, invitedEmail: true, linkedProductUserId: true },
    });
    const participants = new Set([disputeCase.engagement.clientId, disputeCase.engagement.providerId]);
    return {
      items: operators.map((operator) => ({
        staffMemberId: operator.id,
        label: operator.invitedEmail ?? 'Staff operator',
        isSelf: operator.id === member.id,
        conflicted: operator.linkedProductUserId != null && participants.has(operator.linkedProductUserId),
      })),
    };
  }
}

const detailInclude = {
  assignee: { select: { id: true, invitedEmail: true, status: true } },
  closedBy: { select: { id: true, invitedEmail: true } },
  engagement: {
    select: {
      id: true,
      title: true,
      status: true,
      source: true,
      createdAt: true,
      completedAt: true,
      deletedAt: true,
      clientId: true,
      providerId: true,
      client: { select: { id: true, displayName: true, accountStatus: true, deletedAt: true } },
      provider: { select: { id: true, displayName: true, accountStatus: true, deletedAt: true } },
      listing: { select: { id: true, title: true, status: true } },
      serviceOffering: { select: { id: true, title: true, status: true } },
      application: { select: { id: true, status: true } },
      events: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        select: { id: true, fromStatus: true, toStatus: true, actorId: true, note: true, createdAt: true },
      },
      payments: {
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          provider: true,
          createdAt: true,
          succeededAt: true,
          failedAt: true,
          failureCode: true,
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              total: true,
              currency: true,
              issuedAt: true,
              provider: true,
              documentMediaAssetId: true,
            },
          },
        },
      },
    },
  },
  events: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      action: true,
      note: true,
      outcome: true,
      previousStatus: true,
      resultingStatus: true,
      previousAssigneeStaffMemberId: true,
      resultingAssigneeStaffMemberId: true,
      engagementStatusAtAction: true,
      engagementResultingStatus: true,
      createdAt: true,
      actor: { select: { id: true, invitedEmail: true } },
    },
  },
} satisfies Prisma.DisputeCaseInclude;

type DetailRow = Prisma.DisputeCaseGetPayload<{ include: typeof detailInclude }>;
type Person = { id: string; displayName: string; accountStatus: string; deletedAt: Date | null };
type StaffRef = { id: string; invitedEmail: string | null };

function toListItem(row: ListRow, viewerId: string) {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    origin: row.origin,
    openedAt: row.createdAt.toISOString(),
    statusChangedAt: iso(row.statusChangedAt),
    closedOutcome: row.closedOutcome,
    isLatestForEngagement: row.isLatest,
    engagement: {
      id: row.engagement.id,
      title: row.engagement.title,
      status: row.engagement.status,
      deleted: row.engagement.deletedAt != null,
    },
    client: party(row.engagement.client),
    provider: party(row.engagement.provider),
    assignee: assignee(row.assignee, viewerId),
    reason: row.openedEvent?.note.trim() ? row.openedEvent.note : null,
    engagementStillDisputed: row.isLatest && row.engagement.status === WorkEngagementStatus.disputed,
  };
}

function toDetail(
  row: DetailRow,
  otherCases: Array<{ id: string; status: DisputeCaseStatus; createdAt: Date }>,
  viewer: { id: string; linkedProductUserId: string | null },
  knownStaff: StaffRef[],
) {
  const opening = row.openedEventId
    ? row.engagement.events.find((event) => event.id === row.openedEventId) ?? null
    : null;
  const ended = row.engagement.events.find(
    (event) => event.fromStatus === WorkEngagementStatus.disputed && event.createdAt >= row.createdAt,
  );
  const linked =
    viewer.linkedProductUserId === row.engagement.clientId ||
    viewer.linkedProductUserId === row.engagement.providerId;
  const resolutions = resolutionOptions({
    caseStatus: row.status,
    isLatest: row.isLatest,
    engagementStatus: row.engagement.status,
    engagementDeleted: row.engagement.deletedAt != null,
    openedFromStatus: opening?.fromStatus ?? null,
    hasDelivery: row.engagement.events.some((event) => event.toStatus === WorkEngagementStatus.delivered),
    hasSucceededPayment: row.engagement.payments.some((payment) => payment.status === 'succeeded'),
  });
  const known = new Map<string, StaffRef>();
  if (row.assignee) known.set(row.assignee.id, row.assignee);
  for (const event of row.events) known.set(event.actor.id, event.actor);
  for (const member of knownStaff) known.set(member.id, member);
  return {
    case: {
      id: row.id,
      status: row.status,
      revision: row.revision,
      origin: row.origin,
      openedAt: row.createdAt.toISOString(),
      statusChangedAt: iso(row.statusChangedAt),
      closedOutcome: row.closedOutcome,
      closedNote: row.closedNote,
      closedAt: iso(row.closedAt),
      closedBy: row.closedBy ? { label: label(row.closedBy) } : null,
      isLatestForEngagement: row.isLatest,
      engagementStillDisputed: row.isLatest && row.engagement.status === WorkEngagementStatus.disputed,
    },
    otherCases: otherCases.map((item) => ({
      id: item.id,
      status: item.status,
      openedAt: item.createdAt.toISOString(),
    })),
    assignment: {
      assignee: assignee(row.assignee, viewer.id),
      assignedAt: iso(row.assignedAt),
    },
    engagement: {
      id: row.engagement.id,
      title: row.engagement.title,
      status: row.engagement.status,
      source: row.engagement.source,
      createdAt: row.engagement.createdAt.toISOString(),
      completedAt: iso(row.engagement.completedAt),
      deleted: row.engagement.deletedAt != null,
    },
    businessDisputeEnded: ended
      ? {
          toStatus: ended.toStatus,
          at: ended.createdAt.toISOString(),
          by: who(ended.actorId, row.engagement.clientId, row.engagement.providerId),
        }
      : null,
    client: party(row.engagement.client),
    provider: party(row.engagement.provider),
    related: {
      job: row.engagement.listing,
      service: row.engagement.serviceOffering,
      application: row.engagement.application,
    },
    dispute: {
      reason: opening && opening.note.trim() ? opening.note : null,
      openedAt: (opening?.createdAt ?? row.createdAt).toISOString(),
      openedBy: opening ? who(opening.actorId, row.engagement.clientId, row.engagement.providerId) : null,
    },
    engagementHistory: row.engagement.events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      at: event.createdAt.toISOString(),
      by: who(event.actorId, row.engagement.clientId, row.engagement.providerId),
      note: event.toStatus === WorkEngagementStatus.disputed && event.note.trim() ? event.note : null,
    })),
    payments: row.engagement.payments.map((payment) => ({
      id: payment.id,
      amount: money(payment.amount),
      currency: payment.currency.trim(),
      method: payment.method,
      status: payment.status,
      simulated: payment.provider === 'mock',
      createdAt: payment.createdAt.toISOString(),
      succeededAt: iso(payment.succeededAt),
      failedAt: iso(payment.failedAt),
      failureCode: payment.failureCode,
      invoice: payment.invoice
        ? {
            id: payment.invoice.id,
            invoiceNumber: payment.invoice.invoiceNumber,
            status: payment.invoice.status,
            total: money(payment.invoice.total),
            currency: payment.invoice.currency.trim(),
            issuedAt: iso(payment.invoice.issuedAt),
            simulated: payment.invoice.provider === 'mock',
            documentAvailable:
              payment.invoice.status === 'generated' && payment.invoice.documentMediaAssetId != null,
          }
        : null,
    })),
    resolutions,
    notes: row.events
      .filter((event) => event.action === 'note_added' || event.action === 'follow_up_recorded')
      .map((event) => ({
        id: event.id,
        kind: event.action === 'follow_up_recorded' ? ('follow_up' as const) : ('note' as const),
        body: event.note,
        author: { staffMemberId: event.actor.id, label: label(event.actor) },
        createdAt: event.createdAt.toISOString(),
      })),
    history: row.events
      .filter((event) => event.action !== 'note_added' && event.action !== 'follow_up_recorded')
      .map((event) => ({
        id: event.id,
        action: event.action,
        actor: { staffMemberId: event.actor.id, label: label(event.actor) },
        previousStatus: event.previousStatus,
        resultingStatus: event.resultingStatus,
        previousAssignee: staffRef(event.previousAssigneeStaffMemberId, known),
        resultingAssignee: staffRef(event.resultingAssigneeStaffMemberId, known),
        outcome: event.outcome,
        reason: event.note,
        engagementStatusAtAction: event.engagementStatusAtAction,
        engagementResultingStatus: event.engagementResultingStatus,
        createdAt: event.createdAt.toISOString(),
      })),
    viewer: {
      staffMemberId: viewer.id,
      canAct: !linked,
      blockedReason: linked ? ('linked_participant' as const) : null,
      allowedActions: linked
        ? []
        : allowed(row.status, viewer.id, row.assigneeStaffMemberId, row.assignee?.status === 'active', resolutions),
    },
  };
}

function allowed(
  status: DisputeCaseStatus,
  viewerId: string,
  assigneeId: string | null,
  assigneeActive: boolean,
  resolutions: Record<ResolutionAction, { available: boolean }>,
) {
  const actions: Array<'start_review' | 'close' | 'reopen' | 'assign' | 'unassign' | 'note' | ResolutionAction> = ['assign'];
  if (assigneeId) actions.push('unassign');
  const handles = assigneeId === viewerId && assigneeActive;
  if (!handles) return actions;
  if (status === DisputeCaseStatus.open) actions.push('start_review');
  if (status === DisputeCaseStatus.open || status === DisputeCaseStatus.in_review) actions.push('close');
  if (status === DisputeCaseStatus.closed) actions.push('reopen');
  actions.push('note');
  if (resolutions.return_to_client_review.available) actions.push('return_to_client_review');
  if (resolutions.further_work.available) actions.push('further_work');
  if (resolutions.follow_up.available) actions.push('follow_up');
  return actions;
}

function staffRef(id: string | null, known: Map<string, StaffRef>) {
  if (!id) return null;
  const member = known.get(id);
  return { staffMemberId: id, label: member ? label(member) : 'Staff operator' };
}

function assignee(member: (StaffRef & { status: StaffMembershipStatus }) | null, viewerId: string) {
  if (!member) return null;
  return {
    staffMemberId: member.id,
    label: label(member),
    membershipStatus: member.status,
    isSelf: member.id === viewerId,
  };
}

function party(person: Person | null) {
  if (!person) return null;
  return {
    id: person.id,
    displayName: person.displayName,
    accountStatus: person.accountStatus,
    deleted: person.deletedAt != null,
  };
}

function who(actorId: string | null, clientId: string, providerId: string) {
  if (actorId === clientId) return 'client' as const;
  if (actorId === providerId) return 'provider' as const;
  return 'other' as const;
}

function label(member: StaffRef) {
  return member.invitedEmail ?? 'Staff operator';
}

function money(value: { toFixed(digits: number): string } | string) {
  return typeof value === 'string' ? value : value.toFixed(2);
}

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function slice<T>(rows: T[], limit: number, cursorFor: (row: T) => PageCursor) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorFor(last)) : null };
}
