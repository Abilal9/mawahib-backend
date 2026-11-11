import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  StaffAuditAction,
  StaffMembershipStatus,
  StaffRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { SELF_ACTION_FORBIDDEN, STAFF_ACCESS_DENIED } from '../../common/auth/admission.codes';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { decodeCursor, encodeCursor, optionalCursor, parsePageLimit } from './admin-read.query';
import { clientReceivedSql, providerReceivedSql, publishedReviewSql } from '../reviews/review-sql';
import { getReviewAsOf } from '../reviews/review-clock';

const CONTENT_MODERATION_CONFLICT = 'CONTENT_MODERATION_CONFLICT';
const CONTENT_DELETED = 'CONTENT_DELETED';

/**
 * expectedVersion rejects a stale change after any committed hide or restore,
 * including a hide-then-restore cycle, because each committed change increments
 * moderation_version. It does not record which operator made the intervening
 * change. A retry whose desired visibility is already in effect returns
 * unchanged, writes no audit row, and sends no notification, even when the
 * version is older. That unchanged result means the state is already there;
 * it does not mean this request caused it.
 *
 * Signed image URLs last one hour (SIGNED_READ_URL_TTL_SECONDS). Hiding stops
 * new URLs for viewers who fail the post visibility check. The media read
 * route remains owner-only, so another account cannot mint a URL for a post
 * asset. Already issued URLs stay valid until they expire. Bucket policy is
 * unchanged. post_commented notifications keep the comment text they already
 * stored; hiding does not erase delivered copies.
 */
const POST_ACTIONS = [StaffAuditAction.post_hidden, StaffAuditAction.post_restored] as const;
const COMMENT_ACTIONS = [StaffAuditAction.comment_hidden, StaffAuditAction.comment_restored] as const;
const REVIEW_ACTIONS = [StaffAuditAction.review_hidden, StaffAuditAction.review_restored] as const;

export type ContentModerationOutcome = {
  outcome: 'changed' | 'unchanged';
  hidden: boolean;
  hiddenAt: string | null;
  version: number;
};

export type ContentActionRecord = {
  id: string;
  action: 'post_hidden' | 'post_restored' | 'comment_hidden' | 'comment_restored' | 'review_hidden' | 'review_restored';
  actorLabel: string | null;
  reason: string | null;
  createdAt: string;
};

type LockedContent = {
  id: string;
  authorId: string;
  postId: string;
  deletedAt: Date | null;
  hiddenAt: Date | null;
  version: number;
};

@Injectable()
export class ContentModerationService {
  constructor(private readonly prisma: PrismaService) {}

  changePost(
    actor: { issuer: string; subjectId: string },
    postId: string,
    body: Record<string, unknown>,
  ): Promise<ContentModerationOutcome> {
    return this.change('post', actor, postId, body);
  }

  changeComment(
    actor: { issuer: string; subjectId: string },
    commentId: string,
    body: Record<string, unknown>,
  ): Promise<ContentModerationOutcome> {
    return this.change('comment', actor, commentId, body);
  }

  changeReview(
    actor: { issuer: string; subjectId: string },
    reviewId: string,
    body: Record<string, unknown>,
  ): Promise<ContentModerationOutcome> {
    const requestedHidden = parseHidden(body.hidden);
    const expectedVersion = parseVersion(body.expectedVersion);
    const reason = parseReason(body.reason);
    return this.prisma.$transaction((tx) =>
      this.reviewInTransaction(tx, actor, reviewId, requestedHidden, expectedVersion, reason),
    );
  }

  async change(
    kind: 'post' | 'comment',
    actor: { issuer: string; subjectId: string },
    id: string,
    body: Record<string, unknown>,
  ): Promise<ContentModerationOutcome> {
    const requestedHidden = parseHidden(body.hidden);
    const expectedVersion = parseVersion(body.expectedVersion);
    const reason = parseReason(body.reason);
    return this.prisma.$transaction((tx) =>
      this.changeInTransaction(tx, kind, actor, id, requestedHidden, expectedVersion, reason),
    );
  }

  async changeInTransaction(
    tx: Prisma.TransactionClient,
    kind: 'post' | 'comment',
    actor: { issuer: string; subjectId: string },
    id: string,
    requestedHidden: boolean,
    expectedVersion: number,
    reason: string,
  ): Promise<ContentModerationOutcome> {
    const member = await lockActor(tx, actor.issuer, actor.subjectId);
    if (
      !member ||
      member.status !== StaffMembershipStatus.active ||
      member.role !== StaffRole.operator
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: STAFF_ACCESS_DENIED,
        message: 'Staff access is required.',
      });
    }
    const current = kind === 'post' ? await lockPost(tx, id) : await lockComment(tx, id);
    if (!current) throw new NotFoundException('Content not found.');
    if (member.linkedProductUserId === current.authorId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: SELF_ACTION_FORBIDDEN,
        message: 'An operator cannot moderate their own linked content from this session.',
      });
    }
    const hidden = current.hiddenAt !== null;
    if (hidden === requestedHidden) {
      return {
        outcome: 'unchanged',
        hidden,
        hiddenAt: current.hiddenAt?.toISOString() ?? null,
        version: current.version,
      };
    }
    if (current.version !== expectedVersion) {
      throw new ConflictException({
        statusCode: 409,
        code: CONTENT_MODERATION_CONFLICT,
        message: 'This content changed. Refresh it before trying again.',
      });
    }
    if (requestedHidden && current.deletedAt) {
      throw new ConflictException({
        statusCode: 409,
        code: CONTENT_DELETED,
        message: 'Deleted content cannot be hidden.',
      });
    }
    const hiddenAt = requestedHidden ? new Date() : null;
    const updated = kind === 'post'
      ? await tx.post.updateMany({
          where: {
            id,
            moderationVersion: current.version,
            ...(requestedHidden ? { staffHiddenAt: null, deletedAt: null } : { NOT: { staffHiddenAt: null } }),
          },
          data: { staffHiddenAt: hiddenAt, moderationVersion: { increment: 1 } },
        })
      : await tx.postComment.updateMany({
          where: {
            id,
            moderationVersion: current.version,
            ...(requestedHidden ? { staffHiddenAt: null, deletedAt: null } : { NOT: { staffHiddenAt: null } }),
          },
          data: { staffHiddenAt: hiddenAt, moderationVersion: { increment: 1 } },
        });
    if (updated.count !== 1) {
      throw new ConflictException({
        statusCode: 409,
        code: CONTENT_MODERATION_CONFLICT,
        message: 'This content changed. Refresh it before trying again.',
      });
    }
    await tx.staffAuditEvent.create({
      data: {
        action: actionFor(kind, requestedHidden),
        targetSubjectId: id,
        targetPostId: current.postId,
        targetCommentId: kind === 'comment' ? id : null,
        actorSubjectId: member.subjectId,
        actorStaffMemberId: member.id,
        unverifiedProcessUser: null,
        reason,
      },
    });
    if (requestedHidden) {
      await tx.notification.create({
        data: {
          id: randomUUID(),
          recipientId: current.authorId,
          actorId: null,
          type: NotificationType.system,
          title: 'Mawahib',
          body: kind === 'post'
            ? 'Mawahib hid one of your posts.'
            : 'Mawahib hid one of your comments.',
          payload: {
            screen: 'post',
            params: kind === 'post'
              ? { postId: current.postId }
              : { postId: current.postId, commentId: id },
          },
        },
      });
    }
    return {
      outcome: 'changed',
      hidden: requestedHidden,
      hiddenAt: hiddenAt?.toISOString() ?? null,
      version: current.version + 1,
    };
  }

  private async reviewInTransaction(
    tx: Prisma.TransactionClient,
    actor: { issuer: string; subjectId: string },
    id: string,
    requestedHidden: boolean,
    expectedVersion: number,
    reason: string,
  ): Promise<ContentModerationOutcome> {
    const member = await lockActor(tx, actor.issuer, actor.subjectId);
    if (!member || member.status !== StaffMembershipStatus.active || member.role !== StaffRole.operator) {
      throw new ForbiddenException({
        statusCode: 403,
        code: STAFF_ACCESS_DENIED,
        message: 'Staff access is required.',
      });
    }
    const current = await lockReview(tx, id);
    if (!current) throw new NotFoundException('Review not found.');
    if (member.linkedProductUserId === current.reviewerId || member.linkedProductUserId === current.revieweeId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: SELF_ACTION_FORBIDDEN,
        message: 'An operator cannot moderate a review on an engagement they are part of.',
      });
    }
    const hidden = current.hiddenAt !== null;
    if (hidden === requestedHidden) {
      return { outcome: 'unchanged', hidden, hiddenAt: current.hiddenAt?.toISOString() ?? null, version: current.version };
    }
    if (current.version !== expectedVersion) {
      throw new ConflictException({
        statusCode: 409,
        code: CONTENT_MODERATION_CONFLICT,
        message: 'This content changed. Refresh it before trying again.',
      });
    }
    if (requestedHidden && current.engagementDeletedAt) {
      throw new ConflictException({
        statusCode: 409,
        code: CONTENT_DELETED,
        message: 'A review on a deleted engagement cannot be hidden.',
      });
    }
    const hiddenAt = requestedHidden ? new Date() : null;
    const updated = await tx.engagementReview.updateMany({
      where: {
        id,
        moderationVersion: current.version,
        ...(requestedHidden
          ? { staffHiddenAt: null, engagement: { deletedAt: null } }
          : { NOT: { staffHiddenAt: null } }),
      },
      data: { staffHiddenAt: hiddenAt, moderationVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        statusCode: 409,
        code: CONTENT_MODERATION_CONFLICT,
        message: 'This content changed. Refresh it before trying again.',
      });
    }
    await tx.staffAuditEvent.create({
      data: {
        action: requestedHidden ? StaffAuditAction.review_hidden : StaffAuditAction.review_restored,
        targetSubjectId: id,
        targetReviewId: id,
        actorSubjectId: member.subjectId,
        actorStaffMemberId: member.id,
        unverifiedProcessUser: null,
        reason,
      },
    });
    if (requestedHidden) {
      const request = await tx.workRequest.findFirst({
        where: { workEngagementId: current.engagementId },
        select: { id: true },
      });
      await tx.notification.create({
        data: {
          id: randomUUID(),
          recipientId: current.reviewerId,
          actorId: null,
          type: NotificationType.system,
          title: 'Mawahib',
          body: 'Mawahib hid one of your reviews.',
          payload: request
            ? { screen: 'work_request', params: { workRequestId: request.id, reviewId: id } }
            : { screen: 'jobs', params: { reviewId: id } },
        },
      });
    }
    return {
      outcome: 'changed',
      hidden: requestedHidden,
      hiddenAt: hiddenAt?.toISOString() ?? null,
      version: current.version + 1,
    };
  }

  async list(query: Record<string, unknown>): Promise<{
    items: ContentActionRecord[];
    nextCursor: string | null;
  }> {
    const target = parseTarget(query);
    const limit = parsePageLimit(query.limit);
    const cursor = decodeCursor(optionalCursor(query.cursor));
    return this.history(target.kind, target.id, limit, cursor);
  }

  private async history(
    kind: 'post' | 'comment' | 'review',
    id: string,
    limit: number,
    cursor: { at: string; id: string } | null,
  ): Promise<{ items: ContentActionRecord[]; nextCursor: string | null }> {
    const rows = await this.prisma.staffAuditEvent.findMany({
      where: {
        action: { in: [...(kind === 'post' ? POST_ACTIONS : kind === 'comment' ? COMMENT_ACTIONS : REVIEW_ACTIONS)] },
        ...(kind === 'post'
          ? { targetPostId: id, targetCommentId: null }
          : kind === 'comment'
            ? { targetCommentId: id }
            : { targetReviewId: id }),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        actor: { select: { invitedEmail: true } },
        actorStaffMemberId: true,
      },
    });
    const page = rows.length > limit ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action as ContentActionRecord['action'],
        actorLabel: row.actor?.invitedEmail ?? (row.actorStaffMemberId ? 'Staff operator' : null),
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit && last
        ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
        : null,
    };
  }

  async readForReport(type: string, targetId: string): Promise<Record<string, unknown> | null> {
    if (type === 'engagement_review') return this.reviewModeration(targetId);
    if (type !== 'post' && type !== 'post_comment') return null;
    if (type === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id: targetId },
        select: { id: true, staffHiddenAt: true, moderationVersion: true, deletedAt: true },
      });
      if (!post) return null;
      const history = await this.history('post', post.id, 20, null);
      return {
        kind: 'post',
        targetId: post.id,
        postId: post.id,
        hidden: post.staffHiddenAt !== null,
        hiddenAt: post.staffHiddenAt?.toISOString() ?? null,
        version: post.moderationVersion,
        deleted: post.deletedAt !== null,
        history: history.items,
      };
    }
    const comment = await this.prisma.postComment.findUnique({
      where: { id: targetId },
      select: { id: true, postId: true, staffHiddenAt: true, moderationVersion: true, deletedAt: true },
    });
    if (!comment) return null;
    const history = await this.history('comment', comment.id, 20, null);
    return {
      kind: 'comment',
      targetId: comment.id,
      postId: comment.postId,
      hidden: comment.staffHiddenAt !== null,
      hiddenAt: comment.staffHiddenAt?.toISOString() ?? null,
      version: comment.moderationVersion,
      deleted: comment.deletedAt !== null,
      history: history.items,
    };
  }

  private async reviewModeration(id: string) {
    const review = await this.prisma.engagementReview.findUnique({
      where: { id },
      select: {
        id: true,
        rating: true,
        body: true,
        reviewerId: true,
        revieweeId: true,
        staffHiddenAt: true,
        moderationVersion: true,
        reviewer: { select: { id: true, displayName: true } },
        reviewee: { select: { id: true, displayName: true } },
        engagement: {
          select: {
            id: true,
            title: true,
            deletedAt: true,
            clientId: true,
            serviceOffering: { select: { id: true, title: true } },
          },
        },
      },
    });
    if (!review) return null;
    const direction = review.reviewerId === review.engagement.clientId ? 'client_to_provider' : 'provider_to_client';
    const directionSql = direction === 'client_to_provider' ? providerReceivedSql() : clientReceivedSql();
    const asOf = getReviewAsOf();
    const [eligible, hiddenRows, history] = await Promise.all([
      this.prisma.$queryRaw<Array<{ review_count: number; average: Prisma.Decimal | number | null }>>`
        SELECT COUNT(*)::int AS review_count,
               ROUND(AVG(r.rating)::numeric, 1) AS average
        FROM engagement_reviews r
        JOIN work_engagements e ON e.id = r.engagement_id
        WHERE r.reviewee_id = ${review.revieweeId}::uuid
          AND ${directionSql}
          AND ${publishedReviewSql(asOf)}
      `,
      this.prisma.$queryRaw<Array<{ hidden_count: number }>>`
        SELECT COUNT(*)::int AS hidden_count
        FROM engagement_reviews r
        JOIN work_engagements e ON e.id = r.engagement_id
        WHERE r.reviewee_id = ${review.revieweeId}::uuid
          AND r.staff_hidden_at IS NOT NULL
          AND ${directionSql}
      `,
      this.history('review', review.id, 20, null),
    ]);
    const count = eligible[0]?.review_count ?? 0;
    const average = eligible[0]?.average == null ? null : Number(eligible[0].average);
    return {
      kind: 'review' as const,
      targetId: review.id,
      hidden: review.staffHiddenAt != null,
      hiddenAt: review.staffHiddenAt?.toISOString() ?? null,
      version: review.moderationVersion,
      deleted: review.engagement.deletedAt != null,
      rating: review.rating,
      body: review.body,
      direction,
      author: review.reviewer,
      reviewedPerson: review.reviewee,
      engagement: { id: review.engagement.id, title: review.engagement.title, deleted: review.engagement.deletedAt != null },
      service: review.engagement.serviceOffering,
      publicEligible: { count, average: count > 0 ? average : null },
      hiddenReviewCount: hiddenRows[0]?.hidden_count ?? 0,
      history: history.items,
    };
  }
}

function actionFor(kind: 'post' | 'comment', hidden: boolean): StaffAuditAction {
  if (kind === 'post') return hidden ? StaffAuditAction.post_hidden : StaffAuditAction.post_restored;
  return hidden ? StaffAuditAction.comment_hidden : StaffAuditAction.comment_restored;
}

function parseHidden(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException('Choose whether to hide or restore this content.');
  return value;
}

function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException('Refresh this content before trying again.');
  }
  return value;
}

function parseReason(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Enter a reason.');
  const reason = value.trim();
  if (!reason || reason.length > 500) {
    throw new BadRequestException('Enter a reason of up to 500 characters.');
  }
  return reason;
}

function parseTarget(query: Record<string, unknown>): { kind: 'post' | 'comment'; id: string } {
  const postId = optionalId(query.postId);
  const commentId = optionalId(query.commentId);
  if (postId && commentId) throw new BadRequestException('Choose one post or one comment.');
  if (postId) return { kind: 'post', id: postId };
  if (commentId) return { kind: 'comment', id: commentId };
  throw new BadRequestException('Choose one post or one comment.');
}

function optionalId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new BadRequestException('That content filter is not valid.');
  }
  return value;
}

async function lockActor(tx: Prisma.TransactionClient, issuer: string, subjectId: string) {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: StaffMembershipStatus;
    role: StaffRole;
    linked_product_user_id: string | null;
  }>>`
    SELECT id::text AS id,
           status::text AS status,
           role::text AS role,
           linked_product_user_id::text AS linked_product_user_id
    FROM staff_members
    WHERE issuer = ${issuer}
      AND subject_id = CAST(${subjectId} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    role: row.role,
    subjectId,
    linkedProductUserId: row.linked_product_user_id,
  };
}

async function lockReview(tx: Prisma.TransactionClient, id: string): Promise<{
  id: string;
  reviewerId: string;
  revieweeId: string;
  engagementId: string;
  engagementDeletedAt: Date | null;
  hiddenAt: Date | null;
  version: number;
} | null> {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    reviewer_id: string;
    reviewee_id: string;
    engagement_id: string;
    engagement_deleted_at: Date | null;
    staff_hidden_at: Date | null;
    moderation_version: number;
  }>>`
    SELECT r.id::text AS id,
           r.reviewer_id::text AS reviewer_id,
           r.reviewee_id::text AS reviewee_id,
           r.engagement_id::text AS engagement_id,
           e.deleted_at AS engagement_deleted_at,
           r.staff_hidden_at,
           r.moderation_version
    FROM engagement_reviews r
    JOIN work_engagements e ON e.id = r.engagement_id
    WHERE r.id = CAST(${id} AS uuid)
    FOR UPDATE OF r
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    revieweeId: row.reviewee_id,
    engagementId: row.engagement_id,
    engagementDeletedAt: row.engagement_deleted_at,
    hiddenAt: row.staff_hidden_at,
    version: Number(row.moderation_version),
  };
}

async function lockPost(tx: Prisma.TransactionClient, id: string): Promise<LockedContent | null> {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    author_id: string;
    deleted_at: Date | null;
    staff_hidden_at: Date | null;
    moderation_version: number;
  }>>`
    SELECT id::text AS id,
           author_id::text AS author_id,
           deleted_at,
           staff_hidden_at,
           moderation_version
    FROM posts
    WHERE id = CAST(${id} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    postId: row.id,
    deletedAt: row.deleted_at,
    hiddenAt: row.staff_hidden_at,
    version: Number(row.moderation_version),
  };
}

async function lockComment(tx: Prisma.TransactionClient, id: string): Promise<LockedContent | null> {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    author_id: string;
    post_id: string;
    deleted_at: Date | null;
    staff_hidden_at: Date | null;
    moderation_version: number;
  }>>`
    SELECT id::text AS id,
           author_id::text AS author_id,
           post_id::text AS post_id,
           deleted_at,
           staff_hidden_at,
           moderation_version
    FROM post_comments
    WHERE id = CAST(${id} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    postId: row.post_id,
    deletedAt: row.deleted_at,
    hiddenAt: row.staff_hidden_at,
    version: Number(row.moderation_version),
  };
}

export function requireStaffActor(actor: { sub?: string; issuer?: string } | undefined): {
  issuer: string;
  subjectId: string;
} {
  if (!actor?.sub || !actor.issuer) throw new UnauthorizedException();
  return { issuer: actor.issuer, subjectId: actor.sub };
}
