import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  DisputeCaseAction,
  DisputeCaseOutcome,
  DisputeCaseStatus,
  FinancialFollowUpOutcome,
  JobApplicationStatus,
  NotificationType,
  Prisma,
  StaffMembershipStatus,
  StaffRole,
  WorkEngagementStatus,
  WorkRequestEventType,
  WorkRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { assertEngagementTransition } from '../marketplace/state-machines';
import { parseAssignmentBody, parseNoteBody, parseResolutionBody, parseStatusBody } from './dispute-case.query';
import { resolutionRefusal, resolutionTarget, type ResolutionAction, type ResolutionState } from './dispute-resolution';
import { staffClosurePaymentRefusal, unpaidCancellationRefusal } from './staff-closure';

const STAFF_ACCESS_DENIED = 'STAFF_ACCESS_DENIED';
const SELF_ACTION_FORBIDDEN = 'SELF_ACTION_FORBIDDEN';

type Actor = { issuer: string; subjectId: string };
type LockedCase = {
  id: string;
  status: DisputeCaseStatus;
  revision: number;
  assignee_staff_member_id: string | null;
  client_id: string;
  provider_id: string;
  engagement_status: WorkEngagementStatus;
};
type LockedActor = {
  id: string;
  status: StaffMembershipStatus;
  role: StaffRole;
  subjectId: string;
  linkedProductUserId: string | null;
  invitedEmail: string | null;
};

@Injectable()
export class DisputeCaseActionsService {
  constructor(private readonly prisma: PrismaService) {}

  async changeStatus(id: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseStatusBody(body);
    const hash = requestHash({
      kind: 'status',
      action: parsed.action,
      outcome: parsed.outcome,
      note: parsed.note,
      expectedRevision: parsed.expectedRevision,
    });
    return this.prisma.$transaction((tx) => this.status(tx, id, actor, parsed, hash));
  }

  async changeAssignment(id: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseAssignmentBody(body);
    const hash = requestHash({
      kind: 'assignment',
      assigneeStaffMemberId: parsed.assigneeStaffMemberId,
      note: parsed.note,
      expectedRevision: parsed.expectedRevision,
    });
    return this.prisma.$transaction((tx) => this.assignment(tx, id, actor, parsed, hash));
  }

  async addNote(id: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseNoteBody(body);
    const hash = requestHash({ kind: 'note', body: parsed.body });
    return this.prisma.$transaction((tx) => this.note(tx, id, actor, parsed, hash));
  }

  async resolve(id: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseResolutionBody(body);
    const hash = requestHash({
      kind: 'resolution',
      action: parsed.action,
      note: parsed.note,
      expectedRevision: parsed.expectedRevision,
      expectedEngagementStatus: parsed.expectedEngagementStatus,
    });
    return this.prisma.$transaction((tx) => this.resolution(tx, id, actor, parsed, hash));
  }

  async closeWork(id: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseCloseWorkBody(body);
    const hash = requestHash({
      kind: 'close_work',
      reason: parsed.reason,
      expectedRevision: parsed.expectedRevision,
      expectedEngagementStatus: parsed.expectedEngagementStatus,
      confirmedTitle: parsed.confirmedTitle,
      initiation: parsed.initiation,
      financialFollowUpRequired: parsed.financialFollowUpRequired,
    });
    return this.prisma.$transaction((tx) => this.closeWorkInTransaction(tx, id, actor, parsed, hash));
  }

  private async status(
    tx: Prisma.TransactionClient,
    id: string,
    actor: Actor,
    parsed: ReturnType<typeof parseStatusBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const current = await requireCase(tx, id);
    refuseParticipant(staff, current);
    requireHandler(staff, current);
    const replayed = await replay(tx, id, staff, parsed.idempotencyKey, hash);
    if (replayed) return replayed;
    if (current.revision !== parsed.expectedRevision) conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    const next = nextStatus(current.status, parsed.action);
    if (!next) conflict('DISPUTE_CASE_TRANSITION_NOT_ALLOWED', 'That case status change is not allowed.');
    const now = new Date();
    const revision = current.revision + 1;
    const data: Prisma.DisputeCaseUncheckedUpdateManyInput =
      parsed.action === 'close'
        ? {
            status: next,
            revision,
            statusChangedAt: now,
            closedOutcome: parsed.outcome,
            closedNote: parsed.note,
            closedAt: now,
            closedByStaffMemberId: staff.id,
          }
        : parsed.action === 'reopen'
          ? {
              status: next,
              revision,
              statusChangedAt: now,
              closedOutcome: null,
              closedNote: null,
              closedAt: null,
              closedByStaffMemberId: null,
            }
          : { status: next, revision, statusChangedAt: now };
    const updated = await tx.disputeCase.updateMany({ where: { id, revision: current.revision }, data });
    if (updated.count !== 1) conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    const event = await writeEvent(tx, {
      current,
      staff,
      action: actionFor(parsed.action),
      nextStatus: next,
      nextAssignee: current.assignee_staff_member_id,
      nextRevision: revision,
      outcome: parsed.outcome,
      note: parsed.note,
      hash,
      idempotencyKey: parsed.idempotencyKey,
    });
    return changed(id, next, revision, current.assignee_staff_member_id, parsed.outcome, event.id);
  }

  private async assignment(
    tx: Prisma.TransactionClient,
    id: string,
    actor: Actor,
    parsed: ReturnType<typeof parseAssignmentBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const current = await requireCase(tx, id);
    refuseParticipant(staff, current);
    const replayed = await replay(tx, id, staff, parsed.idempotencyKey, hash);
    if (replayed) return replayed;
    if (current.revision !== parsed.expectedRevision) conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    if (current.assignee_staff_member_id === parsed.assigneeStaffMemberId) {
      conflict('DISPUTE_CASE_NO_CHANGE', 'The assignment is already set.');
    }
    if (parsed.assigneeStaffMemberId) {
      const assignee = await tx.staffMember.findUnique({
        where: { id: parsed.assigneeStaffMemberId },
        select: { id: true, status: true, role: true, linkedProductUserId: true },
      });
      if (!assignee || assignee.status !== StaffMembershipStatus.active || assignee.role !== StaffRole.operator) {
        conflict('ASSIGNEE_UNAVAILABLE', 'That operator cannot be assigned.');
      }
      if (
        assignee.linkedProductUserId === current.client_id ||
        assignee.linkedProductUserId === current.provider_id
      ) {
        conflict('ASSIGNEE_IS_PARTICIPANT', 'That operator is a participant in this engagement.');
      }
    }
    const action =
      current.assignee_staff_member_id == null
        ? DisputeCaseAction.assigned
        : parsed.assigneeStaffMemberId == null
          ? DisputeCaseAction.unassigned
          : DisputeCaseAction.reassigned;
    const revision = current.revision + 1;
    const updated = await tx.disputeCase.updateMany({
      where: { id, revision: current.revision },
      data: {
        assigneeStaffMemberId: parsed.assigneeStaffMemberId,
        assignedAt: parsed.assigneeStaffMemberId ? new Date() : null,
        revision,
      },
    });
    if (updated.count !== 1) conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    const event = await writeEvent(tx, {
      current,
      staff,
      action,
      nextStatus: current.status,
      nextAssignee: parsed.assigneeStaffMemberId,
      nextRevision: revision,
      outcome: null,
      note: parsed.note,
      hash,
      idempotencyKey: parsed.idempotencyKey,
    });
    return changed(id, current.status, revision, parsed.assigneeStaffMemberId, null, event.id);
  }

  private async note(
    tx: Prisma.TransactionClient,
    id: string,
    actor: Actor,
    parsed: ReturnType<typeof parseNoteBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const current = await requireCase(tx, id);
    refuseParticipant(staff, current);
    requireHandler(staff, current);
    const existing = await findRequest(tx, id, staff.id, parsed.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
      return {
        outcome: 'replayed' as const,
        note: {
          id: existing.id,
          body: existing.note,
          author: { staffMemberId: staff.id, label: staffLabel(existing.actor.invitedEmail) },
          createdAt: existing.createdAt.toISOString(),
        },
      };
    }
    const event = await writeEvent(tx, {
      current,
      staff,
      action: DisputeCaseAction.note_added,
      nextStatus: current.status,
      nextAssignee: current.assignee_staff_member_id,
      nextRevision: current.revision,
      outcome: null,
      note: parsed.body,
      hash,
      idempotencyKey: parsed.idempotencyKey,
    });
    return {
      outcome: 'changed' as const,
      note: {
        id: event.id,
        body: parsed.body,
        author: { staffMemberId: staff.id, label: staffLabel(staff.invitedEmail) },
        createdAt: event.createdAt.toISOString(),
      },
    };
  }

  private async resolution(
    tx: Prisma.TransactionClient,
    id: string,
    actor: Actor,
    parsed: ReturnType<typeof parseResolutionBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const current = await requireResolutionCase(tx, id);
    refuseParticipant(staff, current);
    requireHandler(staff, current);
    const existing = await findRequest(tx, id, staff.id, parsed.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
      return resolutionResult(
        'replayed',
        id,
        existing.resultingStatus,
        existing.resultingRevision,
        existing.resultingAssigneeStaffMemberId,
        existing.outcome,
        existing.engagementStatusAtAction ?? current.engagement_status,
        existing.engagementResultingStatus ?? existing.engagementStatusAtAction ?? current.engagement_status,
      );
    }
    if (current.revision !== parsed.expectedRevision) {
      conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    }
    if (current.engagement_status !== parsed.expectedEngagementStatus) {
      conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh the case before trying again.');
    }
    const state = resolutionState(current);
    const refusal = resolutionRefusal(state, parsed.action);
    if (refusal) conflict(refusal.code, refusal.message);
    const resultingEngagement = parsed.action === 'follow_up'
      ? WorkEngagementStatus.disputed
      : resolutionTarget(parsed.action);
    if (parsed.action !== 'follow_up') {
      assertEngagementTransition(WorkEngagementStatus.disputed, resultingEngagement);
      const moved = await tx.workEngagement.updateMany({
        where: { id: current.engagement_id, status: WorkEngagementStatus.disputed, deletedAt: null },
        data: { status: resultingEngagement },
      });
      if (moved.count !== 1) conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh the case before trying again.');
      await tx.engagementEvent.create({
        data: {
          engagementId: current.engagement_id,
          fromStatus: WorkEngagementStatus.disputed,
          toStatus: resultingEngagement,
          actorId: null,
          note: '',
        },
      });
    }
    const closing = parsed.action !== 'follow_up';
    const next = closing ? DisputeCaseStatus.closed : current.status;
    const revision = closing ? current.revision + 1 : current.revision;
    const outcome = outcomeFor(parsed.action);
    if (closing) {
      const now = new Date();
      const updated = await tx.disputeCase.updateMany({
        where: { id, revision: current.revision },
        data: {
          status: next,
          revision,
          statusChangedAt: now,
          closedOutcome: outcome,
          closedNote: parsed.note,
          closedAt: now,
          closedByStaffMemberId: staff.id,
        },
      });
      if (updated.count !== 1) conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    }
    const event = await writeEvent(tx, {
      current,
      staff,
      action: actionForResolution(parsed.action),
      nextStatus: next,
      nextAssignee: current.assignee_staff_member_id,
      nextRevision: revision,
      outcome,
      note: parsed.note,
      hash,
      idempotencyKey: parsed.idempotencyKey,
      engagementResultingStatus: resultingEngagement,
    });
    if (parsed.action !== 'follow_up') {
      await notifyParties(tx, current, parsed.action, resultingEngagement);
    }
    return resolutionResult(
      'changed',
      id,
      next,
      revision,
      current.assignee_staff_member_id,
      outcome,
      current.engagement_status,
      resultingEngagement,
      event.id,
    );
  }

  private async closeWorkInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    actor: Actor,
    parsed: ReturnType<typeof parseCloseWorkBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const current = await requireResolutionCase(tx, id);
    refuseParticipant(staff, current);
    requireHandler(staff, current);
    const existing = await findRequest(tx, id, staff.id, parsed.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
      return resolutionResult(
        'replayed',
        id,
        existing.resultingStatus,
        existing.resultingRevision,
        existing.resultingAssigneeStaffMemberId,
        existing.outcome,
        existing.engagementStatusAtAction ?? current.engagement_status,
        existing.engagementResultingStatus ?? WorkEngagementStatus.cancelled,
      );
    }
    if (current.revision !== parsed.expectedRevision) {
      conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    }
    if (current.engagement_status !== parsed.expectedEngagementStatus || !current.is_latest) {
      conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh the case before trying again.');
    }
    if (!CLOSABLE_ENGAGEMENT_STATUSES.has(current.engagement_status)) {
      conflict('ENGAGEMENT_CHANGED', 'Close work only applies to in-progress, delivered, or disputed work.');
    }
    if (current.status !== DisputeCaseStatus.open && current.status !== DisputeCaseStatus.in_review) {
      conflict('DISPUTE_CASE_CLOSED', 'This case is closed. Closing it again does not change the work.');
    }
    if (current.title !== parsed.confirmedTitle) {
      conflict('ENGAGEMENT_CHANGED', 'Confirm the current engagement before closing it.');
    }
    const payments = await tx.$queryRaw<Array<{ status: string; provider: string }>>`
      SELECT status::text AS status, provider::text AS provider
      FROM payments
      WHERE engagement_id = CAST(${current.engagement_id} AS uuid)
      FOR UPDATE
    `;
    const paymentRefusal = staffClosurePaymentRefusal(payments);
    if (paymentRefusal) conflict('PAYMENT_HISTORY_UNSUPPORTED', paymentRefusal);
    if (parsed.initiation.category === 'report') {
      const report = await tx.contentReport.findUnique({
        where: { id: parsed.initiation.reportId },
        select: { id: true },
      });
      if (!report) throw new BadRequestException('The referenced report was not found.');
    }
    assertEngagementTransition(current.engagement_status, WorkEngagementStatus.cancelled);
    const now = new Date();
    const moved = await tx.workEngagement.updateMany({
      where: {
        id: current.engagement_id,
        status: current.engagement_status,
        deletedAt: null,
        staffClosedAt: null,
      },
      data: { status: WorkEngagementStatus.cancelled, staffClosedAt: now },
    });
    if (moved.count !== 1) conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh the case before trying again.');
    await tx.engagementEvent.create({
      data: {
        engagementId: current.engagement_id,
        fromStatus: current.engagement_status,
        toStatus: WorkEngagementStatus.cancelled,
        actorId: null,
        note: 'Closed by Mawahib',
      },
    });
    const revision = current.revision + 1;
    const updated = await tx.disputeCase.updateMany({
      where: { id, revision: current.revision },
      data: {
        status: DisputeCaseStatus.closed,
        revision,
        statusChangedAt: now,
        closedOutcome: DisputeCaseOutcome.closed_by_mawahib,
        closedNote: parsed.reason,
        closedAt: now,
        closedByStaffMemberId: staff.id,
      },
    });
    if (updated.count !== 1) conflict('DISPUTE_CASE_CONFLICT', 'This case changed. Refresh it before trying again.');
    const event = await writeEvent(tx, {
      current,
      staff,
      action: DisputeCaseAction.work_closed,
      nextStatus: DisputeCaseStatus.closed,
      nextAssignee: current.assignee_staff_member_id,
      nextRevision: revision,
      outcome: DisputeCaseOutcome.closed_by_mawahib,
      note: parsed.reason,
      hash,
      idempotencyKey: parsed.idempotencyKey,
      engagementResultingStatus: WorkEngagementStatus.cancelled,
    });
    await tx.staffAuditEvent.create({
      data: {
        action: 'staff_work_closed',
        targetSubjectId: current.engagement_id,
        actorSubjectId: staff.subjectId,
        actorStaffMemberId: staff.id,
        reason: parsed.reason,
        unverifiedProcessUser: null,
      },
    });
    const closure = await tx.engagementStaffClosure.create({
      data: closureData({
        engagementId: current.engagement_id,
        via: 'dispute_case',
        disputeCaseId: current.id,
        fromStatus: current.engagement_status,
        staffId: staff.id,
        closedAt: now,
        initiation: parsed.initiation,
        followUpRequired: parsed.financialFollowUpRequired,
        idempotencyKey: parsed.idempotencyKey,
        requestHash: hash,
      }),
    });
    await notifyClosure(tx, current);
    return resolutionResult(
      'changed',
      id,
      DisputeCaseStatus.closed,
      revision,
      current.assignee_staff_member_id,
      DisputeCaseOutcome.closed_by_mawahib,
      current.engagement_status,
      WorkEngagementStatus.cancelled,
      event.id,
      closure.id,
    );
  }

  async closeFromEngagement(engagementId: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseEngagementCloseBody(body);
    const hash = requestHash({
      kind: 'engagement_close_work',
      engagementId,
      reason: parsed.reason,
      expectedEngagementStatus: parsed.expectedEngagementStatus,
      confirmedTitle: parsed.confirmedTitle,
      initiation: parsed.initiation,
      financialFollowUpRequired: parsed.financialFollowUpRequired,
    });
    return this.prisma.$transaction((tx) => this.closeFromEngagementInTransaction(tx, engagementId, actor, parsed, hash));
  }

  async recordFinancialFollowUp(engagementId: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseFollowUpBody(body);
    const hash = requestHash({
      kind: 'financial_follow_up',
      engagementId,
      outcome: parsed.outcome,
      note: parsed.note,
    });
    return this.prisma.$transaction((tx) => this.recordFollowUpInTransaction(tx, engagementId, actor, parsed, hash));
  }

  private async closeFromEngagementInTransaction(
    tx: Prisma.TransactionClient,
    engagementId: string,
    actor: Actor,
    parsed: ReturnType<typeof parseEngagementCloseBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const engagement = await lockEngagement(tx, engagementId);
    refuseLinkedParty(staff, engagement.client_id, engagement.provider_id);
    const latest = await lockLatestCase(tx, engagementId);
    if (latest && (latest.status === DisputeCaseStatus.open || latest.status === DisputeCaseStatus.in_review)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'DISPUTE_CASE_OPEN',
        message: 'An open dispute case must be closed by its assigned reviewer.',
        caseId: latest.id,
      });
    }
    const existing = await tx.engagementStaffClosure.findUnique({ where: { engagementId } });
    if (existing) {
      if (existing.idempotencyKey === parsed.idempotencyKey && existing.requestHash === hash && existing.closedByStaffMemberId === staff.id) {
        return {
          outcome: 'replayed' as const,
          engagement: { id: engagementId, status: WorkEngagementStatus.cancelled, staffClosedAt: existing.closedAt.toISOString() },
          closureId: existing.id,
          caseId: latest?.id ?? null,
        };
      }
      if (existing.idempotencyKey === parsed.idempotencyKey) {
        conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
      }
      conflict('ENGAGEMENT_ALREADY_CLOSED', 'Mawahib already closed this work.');
    }
    if (engagement.deleted_at) throw new NotFoundException('Engagement not found.');
    if (engagement.staff_closed_at) conflict('ENGAGEMENT_ALREADY_CLOSED', 'Mawahib already closed this work.');
    if (engagement.status !== parsed.expectedEngagementStatus || engagement.title !== parsed.confirmedTitle) {
      conflict('ENGAGEMENT_CHANGED', 'Confirm the current engagement before closing it.');
    }
    const payments = await lockPayments(tx, engagementId);
    const paymentRefusal = staffClosurePaymentRefusal(payments);
    if (paymentRefusal) conflict('PAYMENT_HISTORY_UNSUPPORTED', paymentRefusal);
    await requireReport(tx, parsed.initiation);
    assertEngagementTransition(engagement.status, WorkEngagementStatus.cancelled);
    const now = new Date();
    const moved = await tx.workEngagement.updateMany({
      where: { id: engagementId, status: engagement.status, deletedAt: null, staffClosedAt: null },
      data: { status: WorkEngagementStatus.cancelled, staffClosedAt: now },
    });
    if (moved.count !== 1) conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh it before trying again.');
    await tx.engagementEvent.create({
      data: {
        engagementId,
        fromStatus: engagement.status,
        toStatus: WorkEngagementStatus.cancelled,
        actorId: null,
        note: 'Closed by Mawahib',
      },
    });
    const closure = await tx.engagementStaffClosure.create({
      data: closureData({
        engagementId,
        via: 'engagement',
        disputeCaseId: null,
        fromStatus: engagement.status,
        staffId: staff.id,
        closedAt: now,
        initiation: parsed.initiation,
        followUpRequired: parsed.financialFollowUpRequired,
        idempotencyKey: parsed.idempotencyKey,
        requestHash: hash,
      }),
    });
    await tx.staffAuditEvent.create({
      data: {
        action: 'staff_work_closed',
        targetSubjectId: engagementId,
        actorSubjectId: staff.subjectId,
        actorStaffMemberId: staff.id,
        reason: parsed.reason,
        unverifiedProcessUser: null,
      },
    });
    await notifyPartiesClosed(tx, engagement.client_id, engagement.provider_id, engagementId, engagement.title);
    return {
      outcome: 'changed' as const,
      engagement: { id: engagementId, status: WorkEngagementStatus.cancelled, staffClosedAt: now.toISOString() },
      closureId: closure.id,
      caseId: latest?.id ?? null,
    };
  }

  private async recordFollowUpInTransaction(
    tx: Prisma.TransactionClient,
    engagementId: string,
    actor: Actor,
    parsed: ReturnType<typeof parseFollowUpBody>,
    hash: string,
  ) {
    const staff = await requireActor(tx, actor);
    const engagement = await lockEngagement(tx, engagementId);
    refuseLinkedParty(staff, engagement.client_id, engagement.provider_id);
    const rows = await tx.$queryRaw<Array<{
      id: string;
      follow_up_required: boolean;
      follow_up_outcome: string | null;
      follow_up_recorded_by_staff_member_id: string | null;
      follow_up_idempotency_key: string | null;
      follow_up_request_hash: string | null;
    }>>`
      SELECT id::text AS id,
             follow_up_required,
             follow_up_outcome::text AS follow_up_outcome,
             follow_up_recorded_by_staff_member_id::text AS follow_up_recorded_by_staff_member_id,
             follow_up_idempotency_key,
             follow_up_request_hash
      FROM engagement_staff_closures
      WHERE engagement_id = CAST(${engagementId} AS uuid)
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) conflict('FOLLOW_UP_NOT_RECORDED', 'This closure has no financial follow-up record.');
    if (!row.follow_up_required) conflict('FOLLOW_UP_NOT_REQUIRED', 'Financial follow-up was recorded as not required.');
    if (row.follow_up_outcome) {
      if (
        row.follow_up_recorded_by_staff_member_id === staff.id &&
        row.follow_up_idempotency_key === parsed.idempotencyKey &&
        row.follow_up_request_hash === hash
      ) {
        return { outcome: 'replayed' as const, closureId: row.id, financialFollowUp: 'recorded' as const };
      }
      conflict('FOLLOW_UP_ALREADY_RECORDED', 'Financial follow-up is already recorded.');
    }
    const now = new Date();
    const updated = await tx.engagementStaffClosure.updateMany({
      where: { id: row.id, followUpOutcome: null, followUpRequired: true },
      data: {
        followUpOutcome: parsed.outcome,
        followUpNote: parsed.note,
        followUpRecordedAt: now,
        followUpRecordedByStaffMemberId: staff.id,
        followUpIdempotencyKey: parsed.idempotencyKey,
        followUpRequestHash: hash,
      },
    });
    if (updated.count !== 1) conflict('FOLLOW_UP_ALREADY_RECORDED', 'Financial follow-up is already recorded.');
    await tx.staffAuditEvent.create({
      data: {
        action: 'staff_financial_follow_up_recorded',
        targetSubjectId: engagementId,
        actorSubjectId: staff.subjectId,
        actorStaffMemberId: staff.id,
        reason: parsed.note,
        unverifiedProcessUser: null,
      },
    });
    return { outcome: 'changed' as const, closureId: row.id, financialFollowUp: 'recorded' as const };
  }

  async cancelUnpaidFromEngagement(engagementId: string, actor: Actor, body: Record<string, unknown>) {
    const parsed = parseUnpaidCancelBody(body);
    const hash = requestHash({
      kind: 'staff_unpaid_cancellation',
      engagementId,
      reason: parsed.reason,
      expectedEngagementStatus: parsed.expectedEngagementStatus,
      confirmedTitle: parsed.confirmedTitle,
    });
    return this.prisma.$transaction(
      (tx) => this.cancelUnpaidInTransaction(tx, engagementId, actor, parsed, hash),
      { maxWait: 5_000, timeout: 20_000 },
    );
  }

  private async cancelUnpaidInTransaction(
    tx: Prisma.TransactionClient,
    engagementId: string,
    actor: Actor,
    parsed: ReturnType<typeof parseUnpaidCancelBody>,
    hash: string,
  ) {
    // Staff, then engagement, then the case, payments, and work request.
    // Payment creation locks the engagement before the payer. Deletion locks
    // engagements before the user. This action does not lock a user.
    const staff = await requireActor(tx, actor);
    const engagement = await lockEngagement(tx, engagementId);
    refuseLinkedParty(
      staff,
      engagement.client_id,
      engagement.provider_id,
      'An operator cannot cancel work they are part of.',
    );
    const existing = await tx.staffUnpaidCancellation.findUnique({ where: { engagementId } });
    if (existing) {
      if (
        existing.idempotencyKey === parsed.idempotencyKey
        && existing.requestHash === hash
        && existing.staffMemberId === staff.id
      ) {
        return unpaidCancelResult('replayed', engagementId, existing.id);
      }
      if (existing.idempotencyKey === parsed.idempotencyKey) {
        conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
      }
      conflict('ENGAGEMENT_ALREADY_CANCELLED', 'Mawahib already cancelled this unpaid work.');
    }
    const latest = await lockLatestCaseForHandler(tx, engagementId);
    if (latest && (latest.status === DisputeCaseStatus.open || latest.status === DisputeCaseStatus.in_review)) {
      requireHandler(staff, {
        id: latest.id,
        status: latest.status,
        revision: 0,
        assignee_staff_member_id: latest.assignee_staff_member_id,
        client_id: engagement.client_id,
        provider_id: engagement.provider_id,
        engagement_status: engagement.status,
      });
    }
    if (engagement.status !== parsed.expectedEngagementStatus || engagement.title !== parsed.confirmedTitle) {
      conflict('ENGAGEMENT_CHANGED', 'Confirm the current engagement before cancelling it.');
    }
    const payments = await lockUnpaidPayments(tx, engagementId);
    const paymentRefusal = unpaidCancellationRefusal(payments.map((row) => ({
      status: row.status,
      provider: row.provider,
      providerReference: row.provider_reference,
    })));
    if (paymentRefusal) conflict('PAYMENT_HISTORY_UNSUPPORTED', paymentRefusal);
    const pending = payments.filter((row) => row.status === 'pending');
    if (pending.length > 0) {
      const cancelled = await tx.payment.updateMany({
        where: {
          id: { in: pending.map((row) => row.id) },
          status: 'pending',
          provider: 'mock',
          providerReference: null,
        },
        data: {
          status: 'cancelled',
          failedAt: new Date(),
          failureCode: 'cancelled_before_start',
          failureMessage: 'Cancelled before the payment started.',
        },
      });
      if (cancelled.count !== pending.length) {
        conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh it before trying again.');
      }
    }
    const requests = await tx.$queryRaw<Array<{
      id: string;
      status: string;
      job_application_id: string | null;
    }>>`
      SELECT id::text AS id,
             status::text AS status,
             job_application_id::text AS job_application_id
      FROM work_requests
      WHERE work_engagement_id = CAST(${engagementId} AS uuid)
        AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (requests.length > 1 || (requests[0] && requests[0].status !== WorkRequestStatus.pending_payment)) {
      conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh it before trying again.');
    }
    const moved = await tx.workEngagement.updateMany({
      where: {
        id: engagementId,
        status: WorkEngagementStatus.pending_payment,
        deletedAt: null,
      },
      data: { status: WorkEngagementStatus.cancelled },
    });
    if (moved.count !== 1) conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh it before trying again.');
    await tx.engagementEvent.create({
      data: {
        engagementId,
        fromStatus: WorkEngagementStatus.pending_payment,
        toStatus: WorkEngagementStatus.cancelled,
        actorId: null,
        note: UNPAID_CANCEL_NOTE,
      },
    });
    const request = requests[0];
    if (request) {
      const withdrawn = await tx.workRequest.updateMany({
        where: {
          id: request.id,
          status: WorkRequestStatus.pending_payment,
          deletedAt: null,
        },
        data: { status: WorkRequestStatus.withdrawn },
      });
      if (withdrawn.count !== 1) conflict('ENGAGEMENT_CHANGED', 'The engagement changed. Refresh it before trying again.');
      await tx.workRequestEvent.create({
        data: {
          workRequestId: request.id,
          type: WorkRequestEventType.withdrawn,
          actorId: null,
          fromStatus: WorkRequestStatus.pending_payment,
          toStatus: WorkRequestStatus.withdrawn,
          note: UNPAID_CANCEL_NOTE,
        },
      });
      if (request.job_application_id) {
        await tx.jobApplication.updateMany({
          where: {
            id: request.job_application_id,
            status: {
              in: [
                JobApplicationStatus.submitted,
                JobApplicationStatus.under_review,
                JobApplicationStatus.accepted,
              ],
            },
          },
          data: { status: JobApplicationStatus.withdrawn },
        });
      }
    }
    const cancellation = await tx.staffUnpaidCancellation.create({
      data: {
        id: randomUUID(),
        engagementId,
        staffMemberId: staff.id,
        idempotencyKey: parsed.idempotencyKey,
        requestHash: hash,
      },
    });
    await tx.staffAuditEvent.create({
      data: {
        action: 'staff_unpaid_work_cancelled',
        targetSubjectId: engagementId,
        actorSubjectId: staff.subjectId,
        actorStaffMemberId: staff.id,
        reason: parsed.reason,
        unverifiedProcessUser: null,
      },
    });
    await notifyPartiesUnpaidCancelled(
      tx,
      engagement.client_id,
      engagement.provider_id,
      engagementId,
      engagement.title,
    );
    return unpaidCancelResult('changed', engagementId, cancellation.id);
  }
}

const CLOSABLE_ENGAGEMENT_STATUSES = new Set<WorkEngagementStatus>([
  WorkEngagementStatus.in_progress,
  WorkEngagementStatus.delivered,
  WorkEngagementStatus.disputed,
]);

type Initiation =
  | { category: 'report'; reportId: string }
  | { category: 'support_request'; reference: string }
  | { category: 'staff_observation' };

function isClosableStatus(value: unknown): value is WorkEngagementStatus {
  return typeof value === 'string' && CLOSABLE_ENGAGEMENT_STATUSES.has(value as WorkEngagementStatus);
}

function parseFollowUpRequired(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException('Say whether financial follow-up is required.');
  }
  return value;
}

function parseInitiation(value: unknown): Initiation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Say how this closure was initiated.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.category === 'report' && keys.length === 2 && keys.includes('reportId')) {
    const reportId = typeof record.reportId === 'string' ? record.reportId.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
      throw new BadRequestException('The report reference is not valid.');
    }
    return { category: 'report', reportId };
  }
  if (record.category === 'support_request' && keys.length === 2 && keys.includes('reference')) {
    const reference = typeof record.reference === 'string' ? record.reference.trim() : '';
    if (!reference || reference.length > 120 || /[\r\n]/.test(reference)) {
      throw new BadRequestException('The support reference must be a short single line.');
    }
    return { category: 'support_request', reference };
  }
  if (record.category === 'staff_observation' && keys.length === 1) {
    return { category: 'staff_observation' };
  }
  throw new BadRequestException('Say how this closure was initiated.');
}

function parseEngagementCloseBody(body: Record<string, unknown>) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw new BadRequestException('A staff reason is required.');
  if (!isClosableStatus(body.expectedEngagementStatus)) {
    throw new BadRequestException('Close work only applies to in-progress, delivered, or disputed work.');
  }
  const confirmedTitle = typeof body.confirmedTitle === 'string' ? body.confirmedTitle : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException('A request key is required.');
  return {
    reason,
    expectedEngagementStatus: body.expectedEngagementStatus,
    confirmedTitle,
    idempotencyKey,
    initiation: parseInitiation(body.initiation),
    financialFollowUpRequired: parseFollowUpRequired(body.financialFollowUpRequired),
  };
}

function parseFollowUpBody(body: Record<string, unknown>) {
  const outcome = body.outcome;
  if (
    outcome !== FinancialFollowUpOutcome.no_real_funds &&
    outcome !== FinancialFollowUpOutcome.simulated_exercise &&
    outcome !== FinancialFollowUpOutcome.recorded_outside_provider
  ) {
    throw new BadRequestException('Record whether this was no real funds, a simulated exercise, or a note outside the payment provider.');
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < 3 || note.length > 500) throw new BadRequestException('A follow-up note is required.');
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException('A request key is required.');
  return { outcome, note, idempotencyKey };
}

function closureData(input: {
  engagementId: string;
  via: 'dispute_case' | 'engagement';
  disputeCaseId: string | null;
  fromStatus: WorkEngagementStatus;
  staffId: string;
  closedAt: Date;
  initiation: Initiation;
  followUpRequired: boolean;
  idempotencyKey: string;
  requestHash: string;
}) {
  return {
    engagementId: input.engagementId,
    via: input.via,
    disputeCaseId: input.disputeCaseId,
    fromStatus: input.fromStatus,
    closedByStaffMemberId: input.staffId,
    closedAt: input.closedAt,
    initiationCategory: input.initiation.category,
    initiationReportId: input.initiation.category === 'report' ? input.initiation.reportId : null,
    initiationReference: input.initiation.category === 'support_request' ? input.initiation.reference : null,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    followUpRequired: input.followUpRequired,
  };
}

async function lockEngagement(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: WorkEngagementStatus;
    title: string;
    client_id: string;
    provider_id: string;
    deleted_at: Date | null;
    staff_closed_at: Date | null;
  }>>`
    SELECT id::text AS id,
           status::text AS status,
           title,
           client_id::text AS client_id,
           provider_id::text AS provider_id,
           deleted_at,
           staff_closed_at
    FROM work_engagements
    WHERE id = CAST(${id} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row || row.deleted_at) throw new NotFoundException('Engagement not found.');
  return row;
}

async function lockLatestCase(tx: Prisma.TransactionClient, engagementId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: DisputeCaseStatus }>>`
    SELECT id::text AS id, status::text AS status
    FROM dispute_cases
    WHERE engagement_id = CAST(${engagementId} AS uuid)
      AND is_latest = true
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockPayments(tx: Prisma.TransactionClient, engagementId: string) {
  return tx.$queryRaw<Array<{ status: string; provider: string }>>`
    SELECT status::text AS status, provider::text AS provider
    FROM payments
    WHERE engagement_id = CAST(${engagementId} AS uuid)
    FOR UPDATE
  `;
}

function refuseLinkedParty(
  staff: LockedActor,
  clientId: string,
  providerId: string,
  message = 'An operator cannot close work they are part of.',
) {
  if (staff.linkedProductUserId && (staff.linkedProductUserId === clientId || staff.linkedProductUserId === providerId)) {
    throw new ForbiddenException({
      statusCode: 403,
      code: SELF_ACTION_FORBIDDEN,
      message,
    });
  }
}

async function requireReport(tx: Prisma.TransactionClient, initiation: Initiation) {
  if (initiation.category !== 'report') return;
  const report = await tx.contentReport.findUnique({ where: { id: initiation.reportId }, select: { id: true } });
  if (!report) throw new BadRequestException('The referenced report was not found.');
}

async function notifyPartiesClosed(
  tx: Prisma.TransactionClient,
  clientId: string,
  providerId: string,
  engagementId: string,
  title: string,
) {
  const seen = new Set<string>();
  for (const recipientId of [clientId, providerId]) {
    if (seen.has(recipientId)) continue;
    seen.add(recipientId);
    await tx.notification.create({
      data: {
        id: randomUUID(),
        recipientId,
        actorId: null,
        type: NotificationType.engagement_status,
        title: 'Mawahib',
        body: 'Mawahib closed this work. Payments and invoices are unchanged.',
        payload: {
          screen: 'engagement',
          params: { engagementId, status: WorkEngagementStatus.cancelled, jobTitle: title, closedByMawahib: true },
        },
      },
    });
  }
}

const UNPAID_CANCEL_NOTE = 'Cancelled by Mawahib';
const UNPAID_CANCEL_BODY = 'Mawahib cancelled this unpaid work. No refund is issued.';

function unpaidCancelResult(outcome: 'changed' | 'replayed', engagementId: string, cancellationId: string) {
  return {
    outcome,
    engagement: {
      id: engagementId,
      status: WorkEngagementStatus.cancelled,
      cancelledByMawahib: true as const,
    },
    cancellationId,
  };
}

function parseUnpaidCancelBody(body: Record<string, unknown>) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    throw new BadRequestException('A staff reason is required.');
  }
  if (body.expectedEngagementStatus !== WorkEngagementStatus.pending_payment) {
    throw new BadRequestException('Cancel accepted unpaid work only applies while payment is still outstanding.');
  }
  const confirmedTitle = typeof body.confirmedTitle === 'string' ? body.confirmedTitle : '';
  if (!confirmedTitle) throw new BadRequestException('Confirm the engagement name.');
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new BadRequestException('A request key is required.');
  }
  return {
    reason,
    expectedEngagementStatus: WorkEngagementStatus.pending_payment,
    confirmedTitle,
    idempotencyKey,
  };
}

async function lockLatestCaseForHandler(tx: Prisma.TransactionClient, engagementId: string) {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: DisputeCaseStatus;
    assignee_staff_member_id: string | null;
  }>>`
    SELECT id::text AS id,
           status::text AS status,
           assignee_staff_member_id::text AS assignee_staff_member_id
    FROM dispute_cases
    WHERE engagement_id = CAST(${engagementId} AS uuid)
      AND is_latest = true
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockUnpaidPayments(tx: Prisma.TransactionClient, engagementId: string) {
  return tx.$queryRaw<Array<{
    id: string;
    status: string;
    provider: string;
    provider_reference: string | null;
  }>>`
    SELECT id::text AS id,
           status::text AS status,
           provider::text AS provider,
           provider_reference
    FROM payments
    WHERE engagement_id = CAST(${engagementId} AS uuid)
    FOR UPDATE
  `;
}

async function notifyPartiesUnpaidCancelled(
  tx: Prisma.TransactionClient,
  clientId: string,
  providerId: string,
  engagementId: string,
  title: string,
) {
  const seen = new Set<string>();
  for (const recipientId of [clientId, providerId]) {
    if (seen.has(recipientId)) continue;
    seen.add(recipientId);
    await tx.notification.create({
      data: {
        id: randomUUID(),
        recipientId,
        actorId: null,
        type: NotificationType.engagement_status,
        title: 'Mawahib',
        body: UNPAID_CANCEL_BODY,
        payload: {
          screen: 'engagement',
          params: {
            engagementId,
            status: WorkEngagementStatus.cancelled,
            jobTitle: title,
            cancelledByMawahib: true,
          },
        },
      },
    });
  }
}

function parseCloseWorkBody(body: Record<string, unknown>) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    throw new BadRequestException('A staff reason is required.');
  }
  if (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision)) {
    throw new BadRequestException('The case revision is required.');
  }
  if (!isClosableStatus(body.expectedEngagementStatus)) {
    throw new BadRequestException('Close work only applies to in-progress, delivered, or disputed work.');
  }
  const confirmedTitle = typeof body.confirmedTitle === 'string' ? body.confirmedTitle : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new BadRequestException('A request key is required.');
  }
  return {
    reason,
    expectedRevision: body.expectedRevision,
    expectedEngagementStatus: body.expectedEngagementStatus,
    confirmedTitle,
    idempotencyKey,
    initiation: parseInitiation(body.initiation),
    financialFollowUpRequired: parseFollowUpRequired(body.financialFollowUpRequired),
  };
}

async function notifyClosure(tx: Prisma.TransactionClient, current: ResolutionRow) {
  const seen = new Set<string>();
  for (const recipientId of [current.client_id, current.provider_id]) {
    if (seen.has(recipientId)) continue;
    seen.add(recipientId);
    await tx.notification.create({
      data: {
        id: randomUUID(),
        recipientId,
        actorId: null,
        type: NotificationType.engagement_status,
        title: 'Mawahib',
        body: 'Mawahib closed this work. Payments and invoices are unchanged.',
        payload: {
          screen: 'engagement',
          params: {
            engagementId: current.engagement_id,
            status: WorkEngagementStatus.cancelled,
            jobTitle: current.title,
            closedByMawahib: true,
          },
        },
      },
    });
  }
}

function requestHash(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nextStatus(status: DisputeCaseStatus, action: 'start_review' | 'close' | 'reopen') {
  if (action === 'start_review' && status === DisputeCaseStatus.open) return DisputeCaseStatus.in_review;
  if (action === 'close' && (status === DisputeCaseStatus.open || status === DisputeCaseStatus.in_review)) {
    return DisputeCaseStatus.closed;
  }
  if (action === 'reopen' && status === DisputeCaseStatus.closed) return DisputeCaseStatus.open;
  return null;
}

function actionFor(action: 'start_review' | 'close' | 'reopen') {
  if (action === 'start_review') return DisputeCaseAction.review_started;
  if (action === 'close') return DisputeCaseAction.closed;
  return DisputeCaseAction.reopened;
}

async function requireActor(tx: Prisma.TransactionClient, actor: Actor): Promise<LockedActor> {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: StaffMembershipStatus;
    role: StaffRole;
    linked_product_user_id: string | null;
    invited_email: string | null;
  }>>`
    SELECT id::text AS id,
           status::text AS status,
           role::text AS role,
           linked_product_user_id::text AS linked_product_user_id,
           invited_email
    FROM staff_members
    WHERE issuer = ${actor.issuer}
      AND subject_id = CAST(${actor.subjectId} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row || row.status !== StaffMembershipStatus.active || row.role !== StaffRole.operator) {
    throw new ForbiddenException({
      statusCode: 403,
      code: STAFF_ACCESS_DENIED,
      message: 'Staff access is required.',
    });
  }
  return {
    id: row.id,
    status: row.status,
    role: row.role,
    subjectId: actor.subjectId,
    linkedProductUserId: row.linked_product_user_id,
    invitedEmail: row.invited_email,
  };
}

async function requireCase(tx: Prisma.TransactionClient, id: string): Promise<LockedCase & { engagement_id: string }> {
  const rows = await tx.$queryRaw<Array<LockedCase & { engagement_id: string }>>`
    SELECT c.id::text AS id,
           c.status::text AS status,
           c.revision,
           c.assignee_staff_member_id::text AS assignee_staff_member_id,
           c.engagement_id::text AS engagement_id,
           e.client_id::text AS client_id,
           e.provider_id::text AS provider_id,
           e.status::text AS engagement_status
    FROM dispute_cases c
    JOIN work_engagements e ON e.id = c.engagement_id
    WHERE c.id = CAST(${id} AS uuid)
    FOR UPDATE OF c
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException('Dispute case not found.');
  return row;
}

function requireHandler(staff: LockedActor, current: LockedCase) {
  if (!current.assignee_staff_member_id) {
    conflict('DISPUTE_CASE_UNASSIGNED', 'Assign this case to a reviewer before handling it.');
  }
  if (current.assignee_staff_member_id !== staff.id) {
    conflict('DISPUTE_CASE_NOT_ASSIGNEE', 'Only the assigned reviewer can handle this case.');
  }
}

function refuseParticipant(staff: LockedActor, current: LockedCase) {
  if (
    staff.linkedProductUserId &&
    (staff.linkedProductUserId === current.client_id || staff.linkedProductUserId === current.provider_id)
  ) {
    throw new ForbiddenException({
      statusCode: 403,
      code: SELF_ACTION_FORBIDDEN,
      message: 'An operator cannot handle a dispute on an engagement they are part of.',
    });
  }
}

async function findRequest(tx: Prisma.TransactionClient, caseId: string, actorId: string, key: string) {
  return tx.disputeCaseEvent.findUnique({
    where: {
      caseId_actorStaffMemberId_idempotencyKey: {
        caseId,
        actorStaffMemberId: actorId,
        idempotencyKey: key,
      },
    },
    include: { actor: { select: { invitedEmail: true } } },
  });
}

async function replay(
  tx: Prisma.TransactionClient,
  caseId: string,
  staff: LockedActor,
  key: string,
  hash: string,
) {
  const existing = await findRequest(tx, caseId, staff.id, key);
  if (!existing) return null;
  if (existing.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
  return {
    outcome: 'replayed' as const,
    case: {
      id: caseId,
      status: existing.resultingStatus,
      revision: existing.resultingRevision,
      assigneeStaffMemberId: existing.resultingAssigneeStaffMemberId,
      closedOutcome: existing.outcome,
    },
    eventId: existing.id,
  };
}

async function writeEvent(
  tx: Prisma.TransactionClient,
  input: {
    current: LockedCase & { engagement_id: string };
    staff: LockedActor;
    action: DisputeCaseAction;
    nextStatus: DisputeCaseStatus;
    nextAssignee: string | null;
    nextRevision: number;
    outcome: DisputeCaseOutcome | null;
    note: string;
    hash: string;
    idempotencyKey: string;
    engagementResultingStatus?: WorkEngagementStatus | null;
  },
) {
  try {
    return await tx.disputeCaseEvent.create({
      data: {
        caseId: input.current.id,
        engagementId: input.current.engagement_id,
        action: input.action,
        actorStaffMemberId: input.staff.id,
        actorSubjectId: input.staff.subjectId,
        previousStatus: input.current.status,
        resultingStatus: input.nextStatus,
        previousAssigneeStaffMemberId: input.current.assignee_staff_member_id,
        resultingAssigneeStaffMemberId: input.nextAssignee,
        previousRevision: input.current.revision,
        resultingRevision: input.nextRevision,
        outcome: input.outcome,
        note: input.note,
        engagementStatusAtAction: input.current.engagement_status,
        engagementResultingStatus: input.engagementResultingStatus ?? null,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.hash,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await findRequest(tx, input.current.id, input.staff.id, input.idempotencyKey);
      if (!existing || existing.requestHash !== input.hash) {
        conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used.');
      }
      return existing;
    }
    throw error;
  }
}

function changed(
  id: string,
  status: DisputeCaseStatus,
  revision: number,
  assigneeStaffMemberId: string | null,
  closedOutcome: DisputeCaseOutcome | null,
  eventId: string,
) {
  return {
    outcome: 'changed' as const,
    case: { id, status, revision, assigneeStaffMemberId, closedOutcome },
    eventId,
  };
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ statusCode: 409, code, message });
}

function staffLabel(email: string | null) {
  return email ?? 'Staff operator';
}

type ResolutionRow = LockedCase & {
  engagement_id: string;
  is_latest: boolean;
  opened_from: WorkEngagementStatus | null;
  has_delivery: boolean;
  has_payment: boolean;
  deleted_at: Date | null;
  title: string;
};

async function requireResolutionCase(tx: Prisma.TransactionClient, id: string): Promise<ResolutionRow> {
  // Lock the engagement before the case. A participant dispute already holds
  // the engagement row before the opening trigger locks the case.
  const located = await tx.$queryRaw<Array<{ engagement_id: string }>>`
    SELECT engagement_id::text AS engagement_id
    FROM dispute_cases
    WHERE id = CAST(${id} AS uuid)
  `;
  const engagementId = located[0]?.engagement_id;
  if (!engagementId) throw new NotFoundException('Dispute case not found.');
  await tx.$queryRaw`
    SELECT id FROM work_engagements WHERE id = CAST(${engagementId} AS uuid) FOR UPDATE
  `;
  const rows = await tx.$queryRaw<ResolutionRow[]>`
    SELECT c.id::text AS id,
           c.status::text AS status,
           c.revision,
           c.is_latest,
           c.assignee_staff_member_id::text AS assignee_staff_member_id,
           c.engagement_id::text AS engagement_id,
           e.client_id::text AS client_id,
           e.provider_id::text AS provider_id,
           e.status::text AS engagement_status,
           e.deleted_at,
           e.title,
           ev.from_status::text AS opened_from,
           EXISTS (
             SELECT 1 FROM engagement_events d
             WHERE d.engagement_id = e.id AND d.to_status = 'delivered'
           ) AS has_delivery,
           EXISTS (
             SELECT 1 FROM payments p
             WHERE p.engagement_id = e.id AND p.status = 'succeeded'
           ) AS has_payment
    FROM dispute_cases c
    JOIN work_engagements e ON e.id = c.engagement_id
    LEFT JOIN engagement_events ev ON ev.id = c.opened_event_id
    WHERE c.id = CAST(${id} AS uuid)
    FOR UPDATE OF c
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException('Dispute case not found.');
  return row;
}

function resolutionState(row: ResolutionRow): ResolutionState {
  return {
    caseStatus: row.status,
    isLatest: row.is_latest,
    engagementStatus: row.engagement_status,
    engagementDeleted: row.deleted_at != null,
    openedFromStatus: row.opened_from,
    hasDelivery: row.has_delivery,
    hasSucceededPayment: row.has_payment,
  };
}

function outcomeFor(action: ResolutionAction): DisputeCaseOutcome | null {
  if (action === 'return_to_client_review') return DisputeCaseOutcome.returned_for_client_review;
  if (action === 'further_work') return DisputeCaseOutcome.further_work_agreed;
  return null;
}

function actionForResolution(action: ResolutionAction): DisputeCaseAction {
  if (action === 'return_to_client_review') return DisputeCaseAction.returned_for_client_review;
  if (action === 'further_work') return DisputeCaseAction.further_work_agreed;
  return DisputeCaseAction.follow_up_recorded;
}

function resolutionResult(
  outcome: 'changed' | 'replayed',
  id: string,
  status: DisputeCaseStatus,
  revision: number,
  assigneeStaffMemberId: string | null,
  closedOutcome: DisputeCaseOutcome | null,
  previousStatus: WorkEngagementStatus,
  engagementStatus: WorkEngagementStatus,
  eventId?: string,
  closureId?: string | null,
) {
  return {
    outcome,
    case: { id, status, revision, assigneeStaffMemberId, closedOutcome },
    engagement: { previousStatus, status: engagementStatus },
    paymentsChanged: false as const,
    eventId,
    closureId: closureId ?? null,
  };
}

async function notifyParties(
  tx: Prisma.TransactionClient,
  current: ResolutionRow,
  action: Exclude<ResolutionAction, 'follow_up'>,
  status: WorkEngagementStatus,
) {
  const copy = action === 'return_to_client_review'
    ? {
        client: 'This work is ready for your review again.',
        provider: 'This work is back with the client for review.',
      }
    : {
        client: 'Further work was agreed. The work is in progress.',
        provider: 'Further work was agreed. You can continue and deliver again.',
      };
  const recipients = [
    { id: current.client_id, body: copy.client },
    { id: current.provider_id, body: copy.provider },
  ];
  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (seen.has(recipient.id)) continue;
    seen.add(recipient.id);
    await tx.notification.create({
      data: {
        id: randomUUID(),
        recipientId: recipient.id,
        actorId: null,
        type: NotificationType.engagement_status,
        title: 'Work update',
        body: recipient.body,
        payload: {
          screen: 'engagement',
          params: { engagementId: current.engagement_id, status, jobTitle: current.title },
        },
      },
    });
  }
}
