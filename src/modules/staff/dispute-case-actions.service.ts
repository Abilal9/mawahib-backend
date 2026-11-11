import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DisputeCaseAction,
  DisputeCaseOutcome,
  DisputeCaseStatus,
  Prisma,
  StaffMembershipStatus,
  StaffRole,
  WorkEngagementStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { parseAssignmentBody, parseNoteBody, parseStatusBody } from './dispute-case.query';

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
