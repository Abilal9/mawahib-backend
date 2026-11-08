import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobListingStatus, Prisma, ReportReason, ReportTargetType, ServiceOfferingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { canReadListing } from '../marketplace/listing-visibility';
import { getReviewAsOf } from '../reviews/review-clock';
import { publishedReviewSql } from '../reviews/review-sql';
import { canSaveService } from '../services/saved-service.query';
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
               c.staff_hidden_at AS comment_hidden,
               p.deleted_at AS post_deleted,
               p.staff_hidden_at AS post_hidden,
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
      if (!row || row.comment_deleted || row.comment_hidden || row.post_deleted || row.post_hidden || row.author_deleted) {
        unavailable();
      }
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
    if (targetType === 'user') return this.resolveUser(tx, reporterId, targetId);
    if (targetType === 'post') return this.resolvePost(tx, reporterId, targetId);
    if (targetType === 'engagement_review') return this.resolveReview(tx, reporterId, targetId);
    if (targetType === 'job_listing') return this.resolveJob(tx, reporterId, targetId);
    if (targetType === 'service_offering') return this.resolveService(tx, reporterId, targetId);
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

  private async resolveUser(tx: Prisma.TransactionClient, reporterId: string, targetId: string) {
    if (targetId === reporterId) ownContent('account');
    const rows = await tx.$queryRaw<Array<{ deleted_at: Date | null }>>`
      SELECT deleted_at FROM users WHERE id = CAST(${targetId} AS uuid)
    `;
    if (!rows[0] || rows[0].deleted_at) unavailable();
    return { reportedUserId: targetId, postId: null };
  }

  private async resolvePost(tx: Prisma.TransactionClient, reporterId: string, targetId: string) {
    const rows = await tx.$queryRaw<Array<{
      author_id: string;
      visibility: string;
      deleted_at: Date | null;
      staff_hidden_at: Date | null;
      author_deleted: Date | null;
    }>>`
      SELECT p.author_id::text AS author_id,
             p.visibility::text AS visibility,
             p.deleted_at,
             p.staff_hidden_at,
             u.deleted_at AS author_deleted
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.id = CAST(${targetId} AS uuid)
      FOR UPDATE OF p
    `;
    const row = rows[0];
    if (!row || row.deleted_at || row.staff_hidden_at || row.author_deleted) unavailable();
    if (row.author_id === reporterId) ownContent('content');
    const visible = row.visibility === 'public' || await this.lockActiveConnection(tx, reporterId, row.author_id);
    if (!visible) unavailable();
    return { reportedUserId: row.author_id, postId: null };
  }

  private async resolveReview(tx: Prisma.TransactionClient, reporterId: string, targetId: string) {
    const asOf = getReviewAsOf();
    const rows = await tx.$queryRaw<Array<{
      reviewer_id: string;
      engagement_deleted: Date | null;
      reviewee_deleted: Date | null;
      published: boolean;
    }>>`
      SELECT r.reviewer_id::text AS reviewer_id,
             e.deleted_at AS engagement_deleted,
             reviewee.deleted_at AS reviewee_deleted,
             (${publishedReviewSql(asOf)}) AS published
      FROM engagement_reviews r
      JOIN work_engagements e ON e.id = r.engagement_id
      JOIN users reviewee ON reviewee.id = r.reviewee_id
      WHERE r.id = CAST(${targetId} AS uuid)
    `;
    const row = rows[0];
    if (!row || row.engagement_deleted || row.reviewee_deleted || !row.published) unavailable();
    if (row.reviewer_id === reporterId) ownContent('content');
    return { reportedUserId: row.reviewer_id, postId: null };
  }

  private async resolveJob(tx: Prisma.TransactionClient, reporterId: string, targetId: string) {
    const rows = await tx.$queryRaw<Array<{
      poster_id: string;
      status: JobListingStatus;
      deleted_at: Date | null;
      poster_deleted: Date | null;
    }>>`
      SELECT l.poster_id::text AS poster_id,
             l.status::text AS status,
             l.deleted_at,
             u.deleted_at AS poster_deleted
      FROM job_listings l
      JOIN users u ON u.id = l.poster_id
      WHERE l.id = CAST(${targetId} AS uuid)
    `;
    const row = rows[0];
    if (!row || row.deleted_at || row.poster_deleted) unavailable();
    if (row.poster_id === reporterId) ownContent('content');
    const applications = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM job_applications
      WHERE listing_id = CAST(${targetId} AS uuid)
        AND applicant_id = CAST(${reporterId} AS uuid)
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const visible = canReadListing({
      status: row.status,
      posterId: row.poster_id,
      viewerId: reporterId,
      viewerHasApplication: applications.length > 0,
    });
    if (!visible) unavailable();
    return { reportedUserId: row.poster_id, postId: null };
  }

  private async resolveService(tx: Prisma.TransactionClient, reporterId: string, targetId: string) {
    const rows = await tx.$queryRaw<Array<{
      user_id: string;
      status: ServiceOfferingStatus;
      deleted_at: Date | null;
      owner_deleted: Date | null;
    }>>`
      SELECT s.user_id::text AS user_id,
             s.status::text AS status,
             s.deleted_at,
             u.deleted_at AS owner_deleted
      FROM service_offerings s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = CAST(${targetId} AS uuid)
    `;
    const row = rows[0];
    if (!row) unavailable();
    if (row.user_id === reporterId) ownContent('content');
    if (!canSaveService({ status: row.status, deletedAt: row.deleted_at, ownerDeletedAt: row.owner_deleted })) {
      unavailable();
    }
    return { reportedUserId: row.user_id, postId: null };
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
  comment_hidden: Date | null;
  post_deleted: Date | null;
  post_hidden: Date | null;
  visibility: string;
  post_author: string;
  author_deleted: Date | null;
};

type WorkRequestLock = {
  sender_user_id: string;
  recipient_user_id: string;
  deleted_at: Date | null;
};

function ownContent(kind: 'account' | 'comment' | 'content'): never {
  const message = kind === 'account'
    ? 'You cannot report your own account.'
    : kind === 'comment'
      ? 'You cannot report your own comment.'
      : 'You cannot report your own content.';
  throw new BadRequestException({ statusCode: 400, code: 'REPORT_OWN_CONTENT', message });
}

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
