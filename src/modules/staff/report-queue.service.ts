import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus, ReportTargetType, StaffAuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { getReviewAsOf } from '../reviews/review-clock';
import { publishedReviewSql } from '../reviews/review-sql';
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

  async summary() {
    const [openReports, totalReports] = await Promise.all([
      this.prisma.contentReport.count({ where: { status: 'open' } }),
      this.prisma.contentReport.count(),
    ]);
    return { openReports, totalReports };
  }

  async list(query: Record<string, unknown>) {
    const limit = parseReportLimit(query.limit);
    const cursor = decodeCursor(optionalCursor(query.cursor));
    const statuses = optionalStatuses(query.status);
    const targetTypes = optionalTargets(query.targetType);
    const where = listWhere(statuses, targetTypes, null);
    const [rows, matchCount] = await Promise.all([
      this.prisma.contentReport.findMany({
      where: listWhere(statuses, targetTypes, cursor),
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
    }),
      this.prisma.contentReport.count({ where }),
    ]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
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
      nextCursor: rows.length > limit && last
        ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
        : null,
      matchCount,
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
            actor: { select: { invitedEmail: true } },
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
        actorLabel: event.actor?.invitedEmail ?? (event.actorStaffMemberId ? 'Staff operator' : null),
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
        select: { id: true, visibility: true, deletedAt: true, text: true },
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
          ? {
              id: post.id,
              visibility: post.visibility,
              deleted: Boolean(post.deletedAt),
              excerpt: post.deletedAt ? null : post.text.slice(0, 140),
            }
          : null,
      };
    }
    if (type === 'user') return this.userContext(targetId);
    if (type === 'post') return this.postContext(targetId);
    if (type === 'engagement_review') return this.reviewContext(targetId);
    if (type === 'job_listing') return this.jobContext(targetId);
    if (type === 'service_offering') return this.serviceContext(targetId);
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

  private async userContext(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userBits });
    if (!user) return { state: 'missing' as const };
    return { state: user.deletedAt ? ('deleted' as const) : ('available' as const), user: person(user) };
  }

  private async postContext(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        visibility: true,
        text: true,
        createdAt: true,
        deletedAt: true,
        author: { select: { deletedAt: true } },
        _count: { select: { media: true } },
      },
    });
    if (!post) return { state: 'missing' as const };
    const current = !post.deletedAt && !post.author.deletedAt;
    return {
      state: post.deletedAt ? ('deleted' as const) : ('available' as const),
      post: {
        id: post.id,
        visibility: post.visibility,
        createdAt: post.createdAt.toISOString(),
        deleted: Boolean(post.deletedAt),
        mediaCount: post._count.media,
        excerpt: current ? post.text.slice(0, 140) : null,
      },
    };
  }

  private async reviewContext(id: string) {
    const review = await this.prisma.engagementReview.findUnique({
      where: { id },
      select: {
        id: true,
        rating: true,
        body: true,
        createdAt: true,
        reviewerId: true,
        reviewer: { select: userBits },
        reviewee: { select: userBits },
        engagement: { select: { id: true, title: true, deletedAt: true, clientId: true } },
        _count: { select: { media: true } },
      },
    });
    if (!review) return { state: 'missing' as const };
    const published = await this.reviewPublished(id);
    const deleted = Boolean(review.engagement.deletedAt);
    return {
      state: deleted ? ('deleted' as const) : ('available' as const),
      review: {
        id: review.id,
        rating: review.rating,
        body: deleted ? null : review.body,
        createdAt: review.createdAt.toISOString(),
        publishedNow: published,
        direction: review.reviewerId === review.engagement.clientId ? 'client_to_provider' : 'provider_to_client',
        mediaCount: review._count.media,
      },
      engagement: {
        id: review.engagement.id,
        title: review.engagement.title,
        deleted,
      },
      reviewer: person(review.reviewer),
      reviewee: person(review.reviewee),
    };
  }

  private async reviewPublished(id: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ published: boolean }>>`
      SELECT (${publishedReviewSql(getReviewAsOf())}) AS published
      FROM engagement_reviews r
      JOIN work_engagements e ON e.id = r.engagement_id
      WHERE r.id = CAST(${id} AS uuid)
    `;
    return Boolean(rows[0]?.published);
  }

  private async jobContext(id: string) {
    const job = await this.prisma.jobListing.findUnique({
      where: { id },
      select: { id: true, title: true, companyName: true, status: true, postedAt: true, createdAt: true, deletedAt: true },
    });
    if (!job) return { state: 'missing' as const };
    return {
      state: job.deletedAt ? ('deleted' as const) : ('available' as const),
      job: {
        id: job.id,
        title: job.title,
        companyName: job.companyName,
        status: job.status,
        postedAt: job.postedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        deleted: Boolean(job.deletedAt),
      },
    };
  }

  private async serviceContext(id: string) {
    const service = await this.prisma.serviceOffering.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, createdAt: true, deletedAt: true },
    });
    if (!service) return { state: 'missing' as const };
    return {
      state: service.deletedAt ? ('deleted' as const) : ('available' as const),
      service: {
        id: service.id,
        title: service.title,
        status: service.status,
        createdAt: service.createdAt.toISOString(),
        deleted: Boolean(service.deletedAt),
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

function listWhere(
  statuses: ReportStatus[] | null,
  targetTypes: ReportTargetType[] | null,
  cursor: PageCursor | null,
): Prisma.ContentReportWhereInput {
  return {
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(targetTypes ? { targetType: { in: targetTypes } } : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            },
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

function optionalStatuses(value: unknown): ReportStatus[] | null {
  return parseChoice(value, ['open', 'resolved', 'dismissed'], 'That status filter is not valid.') as ReportStatus[] | null;
}

function optionalTargets(value: unknown): ReportTargetType[] | null {
  return parseChoice(value, Object.values(ReportTargetType), 'That target filter is not valid.') as ReportTargetType[] | null;
}

function parseChoice(value: unknown, allowed: readonly string[], message: string): string[] | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const items = [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
  if (items.length === 0 || items.includes('all')) return null;
  if (items.some((item) => !allowed.includes(item))) throw new BadRequestException(message);
  return items;
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
