import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus, ReportTargetType, StaffAuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { decodeCursor, encodeCursor, optionalCursor, type PageCursor } from './admin-read.query';
import { ReportStatusDto } from '../reports/report.dto';

const REPORT_ACTIONS = [
  StaffAuditAction.report_resolved,
  StaffAuditAction.report_dismissed,
  StaffAuditAction.report_reopened,
] as const;

@Injectable()
export class ReportQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const limit = parseReportLimit(query.limit);
    const cursor = decodeCursor(optionalCursor(query.cursor));
    const status = optionalStatus(query.status);
    const targetType = optionalTarget(query.targetType);
    const rows = await this.prisma.contentReport.findMany({
      where: listWhere(status, targetType, cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        targetType: true,
        reason: true,
        status: true,
        createdAt: true,
        statusChangedAt: true,
        details: true,
        reportedUser: { select: userBits },
      },
    });
    const page = rows.slice(0, limit);
    const extra = rows[limit];
    return {
      items: page.map((row) => ({
        id: row.id,
        targetType: row.targetType,
        reason: row.reason,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
        hasDetails: Boolean(row.details),
        reportedUser: person(row.reportedUser),
      })),
      nextCursor: extra ? encodeCursor({ at: extra.createdAt.toISOString(), id: extra.id }) : null,
    };
  }

  async detail(id: string) {
    const row = await this.prisma.contentReport.findUnique({
      where: { id },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        details: true,
        status: true,
        contextPostId: true,
        createdAt: true,
        statusChangedAt: true,
        reporter: { select: userBits },
        reportedUser: { select: userBits },
        auditEvents: {
          where: { action: { in: [...REPORT_ACTIONS] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            action: true,
            actorSubjectId: true,
            actorStaffMemberId: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Report not found.');
    return {
      id: row.id,
      targetType: row.targetType,
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
      reporter: person(row.reporter),
      reportedUser: person(row.reportedUser),
      target: await this.targetContext(row.targetType, row.targetId, row.contextPostId),
      history: row.auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        actorSubjectId: event.actorSubjectId,
        actorStaffMemberId: event.actorStaffMemberId,
        note: event.reason,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async changeStatus(
    id: string,
    actor: { issuer: string; subjectId: string },
    body: ReportStatusDto,
  ) {
    const note = parseNote(body.note);
    const next = body.status;
    const expected = body.expectedStatus;
    if (!allowed(expected, next)) {
      throw new BadRequestException('That report status change is not allowed.');
    }
    return this.prisma.$transaction(async (tx) => {
      const staff = await lockActor(tx, actor.issuer, actor.subjectId);
      if (!staff || staff.status !== 'active' || staff.role !== 'operator') {
        throw new NotFoundException('Report not found.');
      }
      const rows = await tx.$queryRaw<Array<{ id: string; status: ReportStatus }>>`
        SELECT id::text AS id, status::text AS status
        FROM content_reports
        WHERE id = CAST(${id} AS uuid)
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException('Report not found.');
      if (current.status !== expected) {
        throw new ConflictException('This report changed. Refresh it before trying again.');
      }
      const action = auditAction(expected, next);
      try {
        await tx.contentReport.update({
          where: { id },
          data: {
            status: next,
            statusChangedAt: new Date(),
            statusChangedByStaffMemberId: staff.id,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException({
            statusCode: 409,
            code: 'REPORT_DUPLICATE_OPEN',
            message: 'An open report already exists for this target.',
          });
        }
        throw error;
      }
      await tx.staffAuditEvent.create({
        data: {
          action,
          targetSubjectId: id,
          targetReportId: id,
          actorSubjectId: actor.subjectId,
          actorStaffMemberId: staff.id,
          reason: note,
        },
      });
      return { id, status: next };
    });
  }

  private async targetContext(type: ReportTargetType, targetId: string, postId: string | null) {
    if (type === 'post_comment') {
      const comment = await this.prisma.postComment.findUnique({
        where: { id: targetId },
        select: { id: true, text: true, createdAt: true, deletedAt: true, postId: true },
      });
      const post = await this.prisma.post.findUnique({
        where: { id: postId ?? comment?.postId ?? targetId },
        select: { id: true, visibility: true, deletedAt: true },
      });
      if (!comment) return { state: 'missing' as const };
      return {
        state: comment.deletedAt ? ('deleted' as const) : ('available' as const),
        comment: {
          id: comment.id,
          text: comment.text,
          createdAt: comment.createdAt.toISOString(),
          deletedAt: comment.deletedAt?.toISOString() ?? null,
        },
        post: post
          ? { id: post.id, visibility: post.visibility, deleted: Boolean(post.deletedAt) }
          : null,
      };
    }
    const request = await this.prisma.workRequest.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        title: true,
        status: true,
        source: true,
        createdAt: true,
        deletedAt: true,
        senderUserId: true,
        recipientUserId: true,
      },
    });
    if (!request) return { state: 'missing' as const };
    return {
      state: request.deletedAt ? ('deleted' as const) : ('available' as const),
      workRequest: {
        id: request.id,
        title: request.title,
        status: request.status,
        source: request.source,
        createdAt: request.createdAt.toISOString(),
        deletedAt: request.deletedAt?.toISOString() ?? null,
        senderUserId: request.senderUserId,
        recipientUserId: request.recipientUserId,
      },
    };
  }
}

const userBits = { id: true, displayName: true, accountStatus: true, deletedAt: true } as const;

function person(user: { id: string; displayName: string; accountStatus: string; deletedAt: Date | null } | null) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName,
    accountStatus: user.accountStatus,
    deleted: Boolean(user.deletedAt),
  };
}

function listWhere(status: ReportStatus | null, targetType: ReportTargetType | null, cursor: PageCursor | null) {
  return {
    ...(status ? { status } : {}),
    ...(targetType ? { targetType } : {}),
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.at) } },
            { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
          ],
        }
      : {}),
  };
}

function parseReportLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 25;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new BadRequestException('Page size must be from 1 to 50.');
  }
  return parsed;
}

function optionalStatus(value: unknown): ReportStatus | null {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  if (value === 'open' || value === 'resolved' || value === 'dismissed') return value;
  throw new BadRequestException('That status filter is not valid.');
}

function optionalTarget(value: unknown): ReportTargetType | null {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  if (value === 'post_comment' || value === 'work_request') return value;
  throw new BadRequestException('That target filter is not valid.');
}

function parseNote(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Enter a note.');
  const note = value.trim();
  if (!note || note.length > 500) throw new BadRequestException('Enter a note of up to 500 characters.');
  return note;
}

function allowed(from: ReportStatus, to: ReportStatus): boolean {
  if (from === 'open' && (to === 'resolved' || to === 'dismissed')) return true;
  if ((from === 'resolved' || from === 'dismissed') && to === 'open') return true;
  return false;
}

function auditAction(_from: ReportStatus, to: ReportStatus): StaffAuditAction {
  if (to === 'resolved') return StaffAuditAction.report_resolved;
  if (to === 'dismissed') return StaffAuditAction.report_dismissed;
  return StaffAuditAction.report_reopened;
}

async function lockActor(tx: Prisma.TransactionClient, issuer: string, subjectId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string; role: string }>>`
    SELECT id::text AS id, status::text AS status, role::text AS role
    FROM staff_members
    WHERE issuer = ${issuer}
      AND subject_id = CAST(${subjectId} AS uuid)
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
