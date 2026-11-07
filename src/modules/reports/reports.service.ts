import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportReason, ReportTargetType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateReportDto } from './report.dto';

const HOUR_LIMIT = 10;
const DAY_LIMIT = 30;

export class ReportRateLimited extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: 429,
        code: 'REPORT_RATE_LIMITED',
        message: 'Too many reports. Try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(reporterId: string, body: CreateReportDto) {
    const details = parseDetails(body.reason, body.details);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`report:${reporterId}`}, 0))`;
        const target = await this.resolveTarget(tx, reporterId, body.targetType, body.targetId);
        const existing = await tx.contentReport.findFirst({
          where: {
            reporterUserId: reporterId,
            targetType: body.targetType,
            targetId: body.targetId,
            status: 'open',
          },
          select: { id: true, createdAt: true },
        });
        if (existing) {
          return { reportId: existing.id, receivedAt: existing.createdAt.toISOString(), alreadyReported: true };
        }
        await this.assertRate(tx, reporterId);
        const created = await tx.contentReport.create({
          data: {
            reporterUserId: reporterId,
            targetType: body.targetType,
            targetId: body.targetId,
            reportedUserId: target.reportedUserId,
            contextPostId: target.postId,
            reason: body.reason,
            details,
          },
          select: { id: true, createdAt: true },
        });
        return { reportId: created.id, receivedAt: created.createdAt.toISOString(), alreadyReported: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.contentReport.findFirst({
          where: {
            reporterUserId: reporterId,
            targetType: body.targetType,
            targetId: body.targetId,
            status: 'open',
          },
          select: { id: true, createdAt: true },
        });
        if (raced) {
          return { reportId: raced.id, receivedAt: raced.createdAt.toISOString(), alreadyReported: true };
        }
      }
      throw error;
    }
  }

  private async resolveTarget(
    tx: Prisma.TransactionClient,
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<{ reportedUserId: string; postId: string | null }> {
    if (targetType === 'post_comment') {
      const rows = await tx.$queryRaw<CommentLock[]>`
        SELECT c.author_id::text AS author_id,
               c.post_id::text AS post_id,
               c.deleted_at AS comment_deleted,
               p.deleted_at AS post_deleted,
               p.visibility::text AS visibility,
               p.author_id::text AS post_author,
               u.deleted_at AS author_deleted
        FROM post_comments c
        JOIN posts p ON p.id = c.post_id
        JOIN users u ON u.id = p.author_id
        WHERE c.id = CAST(${targetId} AS uuid)
        FOR UPDATE OF c, p
      `;
      const row = rows[0];
      if (!row || row.comment_deleted || row.post_deleted || row.author_deleted) unavailable();
      if (row.author_id === reporterId) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'REPORT_OWN_CONTENT',
          message: 'You cannot report your own comment.',
        });
      }
      const visible = row.visibility === 'public'
        || row.post_author === reporterId
        || await this.lockActiveConnection(tx, reporterId, row.post_author);
      if (!visible) unavailable();
      return { reportedUserId: row.author_id, postId: row.post_id };
    }
    const rows = await tx.$queryRaw<WorkRequestLock[]>`
      SELECT sender_user_id::text AS sender_user_id,
             recipient_user_id::text AS recipient_user_id,
             deleted_at
      FROM work_requests
      WHERE id = CAST(${targetId} AS uuid)
      FOR UPDATE
    `;
    const request = rows[0];
    if (!request || request.deleted_at) unavailable();
    if (request.sender_user_id !== reporterId && request.recipient_user_id !== reporterId) unavailable();
    return {
      reportedUserId: request.sender_user_id === reporterId ? request.recipient_user_id : request.sender_user_id,
      postId: null,
    };
  }

  private async lockActiveConnection(tx: Prisma.TransactionClient, left: string, right: string): Promise<boolean> {
    const [low, high] = left < right ? [left, right] : [right, left];
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM connections
      WHERE ended_at IS NULL
        AND user_low_id = CAST(${low} AS uuid)
        AND user_high_id = CAST(${high} AS uuid)
      FOR UPDATE
    `;
    return rows.length > 0;
  }

  private async assertRate(tx: Prisma.TransactionClient, reporterId: string) {
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60 * 1000);
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const [hour, day] = await Promise.all([
      tx.contentReport.count({ where: { reporterUserId: reporterId, createdAt: { gt: hourAgo } } }),
      tx.contentReport.count({ where: { reporterUserId: reporterId, createdAt: { gt: dayAgo } } }),
    ]);
    if (hour >= HOUR_LIMIT) throw new ReportRateLimited(60 * 60);
    if (day >= DAY_LIMIT) throw new ReportRateLimited(24 * 60 * 60);
  }
}

type CommentLock = {
  author_id: string;
  post_id: string;
  comment_deleted: Date | null;
  post_deleted: Date | null;
  visibility: string;
  post_author: string;
  author_deleted: Date | null;
};

type WorkRequestLock = {
  sender_user_id: string;
  recipient_user_id: string;
  deleted_at: Date | null;
};

function unavailable(): never {
  throw new NotFoundException({
    statusCode: 404,
    code: 'REPORT_TARGET_UNAVAILABLE',
    message: 'This is no longer available.',
  });
}

function parseDetails(reason: ReportReason, value: string | undefined): string | null {
  const details = typeof value === 'string' ? value.trim() : '';
  if (reason === 'other' && details.length < 10) {
    throw new BadRequestException('Describe the report in at least 10 characters.');
  }
  if (details.length > 1000) {
    throw new BadRequestException('Keep the explanation to 1000 characters.');
  }
  return details || null;
}
