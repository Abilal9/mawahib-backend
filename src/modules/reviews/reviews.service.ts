import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaPurpose, Prisma, WorkEngagementStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  decodeSaveCursor,
  encodeSaveCursor,
  savePageLimit,
  type SaveCursor,
} from '../../common/save-cursor';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MediaService } from '../media/media.service';
import { publicReviewLabel } from '../marketplace/public-review-label';
import {
  anyReceivedSql,
  clientReceivedSql,
  providerReceivedSql,
  publishedReviewSql,
  serviceReviewSql,
} from './review-sql';
import {
  EMPTY_AGGREGATE,
  emptyUserAggregate,
  type ReviewAggregate,
  type ReviewSummaryPair,
} from './review-summary';
import { normalizeReviewBody, sameReviewContent } from './review-window';

const reviewerSelect = {
  id: true,
  displayName: true,
  username: true,
  accountType: true,
  isVerified: true,
  profile: { select: { avatarUrl: true, title: true } },
} satisfies Prisma.UserSelect;

const reviewInclude = {
  reviewer: { select: reviewerSelect },
  media: {
    orderBy: { position: 'asc' as const },
    include: {
      mediaAsset: {
        select: {
          mimeType: true,
          purpose: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  },
  engagement: {
    select: {
      id: true,
      title: true,
      source: true,
      clientId: true,
      providerId: true,
      deletedAt: true,
      serviceOfferingId: true,
      listing: { select: { title: true, status: true, deletedAt: true } },
      serviceOffering: {
        select: { title: true, status: true, deletedAt: true },
      },
    },
  },
} satisfies Prisma.EngagementReviewInclude;

export type ListedReview = Prisma.EngagementReviewGetPayload<{
  include: typeof reviewInclude;
}>;

export interface ReviewPage {
  items: ListedReview[];
  nextCursor: string | null;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async submit(input: {
    reviewerId: string;
    engagementId: string;
    rating: number;
    body?: string | null;
    mediaAssetIds?: string[];
    asOf: Date;
  }) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new BadRequestException('Rating must be an integer from 1 to 5');
    }
    const body = normalizeReviewBody(input.body);
    if (body.length > 2000) {
      throw new BadRequestException(
        'Review text must be at most 2000 characters',
      );
    }

    const engagement = await this.prisma.workEngagement.findUnique({
      where: { id: input.engagementId },
      include: {
        reviews: { include: { media: { orderBy: { position: 'asc' } } } },
      },
    });
    const party =
      engagement &&
      engagement.deletedAt == null &&
      (engagement.clientId === input.reviewerId ||
        engagement.providerId === input.reviewerId);
    if (!engagement || !party) {
      throw new NotFoundException('Engagement not found');
    }
    if (engagement.clientId === engagement.providerId) {
      throw new BadRequestException('A review requires two participants');
    }
    if (engagement.status !== WorkEngagementStatus.completed) {
      throw new BadRequestException(
        'Reviews are only allowed after the engagement is completed',
      );
    }
    if (!engagement.completedAt || !engagement.reviewWindowClosesAt) {
      throw new BadRequestException(
        'Reviews are only allowed after the engagement is completed',
      );
    }

    const revieweeId =
      engagement.clientId === input.reviewerId
        ? engagement.providerId
        : engagement.clientId;
    const mediaAssetIds = [...new Set(input.mediaAssetIds ?? [])];
    const existing = engagement.reviews.find(
      (review) => review.reviewerId === input.reviewerId,
    );
    if (existing) {
      const identical = sameReviewContent(
        {
          rating: existing.rating,
          body: existing.body,
          mediaAssetIds: existing.media.map((item) => item.mediaAssetId),
        },
        { rating: input.rating, body, mediaAssetIds },
      );
      if (!identical) {
        throw new ConflictException(
          'A review has already been submitted for this engagement',
        );
      }
      return this.finishSubmit(existing.id, input.engagementId, revieweeId);
    }

    if (input.asOf >= engagement.reviewWindowClosesAt) {
      throw new BadRequestException('The review period has ended');
    }
    if (mediaAssetIds.length > 4) {
      throw new BadRequestException('A review can include at most 4 images');
    }
    if (mediaAssetIds.length) {
      const assets = await this.media.requireReadyOwnedAssets(
        input.reviewerId,
        mediaAssetIds,
      );
      if (assets.some((asset) => asset.purpose !== MediaPurpose.review)) {
        throw new BadRequestException(
          'Review images must be uploaded with purpose review',
        );
      }
    }

    try {
      const createdId = await this.prisma.$transaction(async (tx) => {
        const open = await tx.workEngagement.findFirst({
          where: {
            id: input.engagementId,
            deletedAt: null,
            status: WorkEngagementStatus.completed,
            completedAt: { not: null },
            reviewWindowClosesAt: { gt: input.asOf },
            OR: [
              { clientId: input.reviewerId },
              { providerId: input.reviewerId },
            ],
          },
          select: { id: true },
        });
        if (!open) {
          throw new BadRequestException('The review period has ended');
        }
        const created = await tx.engagementReview.create({
          data: {
            id: randomUUID(),
            engagementId: input.engagementId,
            reviewerId: input.reviewerId,
            revieweeId,
            rating: input.rating,
            body,
            ...(mediaAssetIds.length
              ? {
                  media: {
                    create: mediaAssetIds.map((mediaAssetId, position) => ({
                      mediaAssetId,
                      position,
                    })),
                  },
                }
              : {}),
          },
          select: { id: true },
        });
        return created.id;
      });
      return this.finishSubmit(createdId, input.engagementId, revieweeId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.engagementReview.findUnique({
        where: {
          engagementId_reviewerId: {
            engagementId: input.engagementId,
            reviewerId: input.reviewerId,
          },
        },
        include: { media: true },
      });
      if (!raced) throw error;
      const identical = sameReviewContent(
        {
          rating: raced.rating,
          body: raced.body,
          mediaAssetIds: raced.media.map((item) => item.mediaAssetId),
        },
        { rating: input.rating, body, mediaAssetIds },
      );
      if (!identical) {
        throw new ConflictException(
          'A review has already been submitted for this engagement',
        );
      }
      return this.finishSubmit(raced.id, input.engagementId, revieweeId);
    }
  }

  async listReceived(input: {
    userId: string;
    role?: 'provider' | 'client';
    cursor?: string | null;
    limit?: number;
    asOf: Date;
  }): Promise<ReviewPage> {
    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const roleSql =
      input.role === 'provider'
        ? providerReceivedSql()
        : input.role === 'client'
          ? clientReceivedSql()
          : anyReceivedSql();
    return this.pageReviews({
      cursor: decodeSaveCursor(input.cursor),
      limit: savePageLimit(input.limit),
      where: Prisma.sql`
        r.reviewee_id = ${input.userId}::uuid
        AND ${roleSql}
        AND ${publishedReviewSql(input.asOf)}
      `,
    });
  }

  async listForService(input: {
    serviceId: string;
    cursor?: string | null;
    limit?: number;
    asOf: Date;
  }): Promise<ReviewPage> {
    const service = await this.prisma.serviceOffering.findFirst({
      where: { id: input.serviceId, deletedAt: null },
      select: { id: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    return this.pageReviews({
      cursor: decodeSaveCursor(input.cursor),
      limit: savePageLimit(input.limit),
      where: Prisma.sql`
        e.service_offering_id = ${input.serviceId}::uuid
        AND ${serviceReviewSql()}
        AND ${publishedReviewSql(input.asOf)}
      `,
    });
  }

  async summarizeUsers(
    userIds: string[],
    asOf: Date,
  ): Promise<Map<string, ReviewSummaryPair>> {
    const result = new Map<string, ReviewSummaryPair>();
    if (userIds.length === 0) return result;
    const ids = Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`));
    const receivedWhere = Prisma.sql`
      r.reviewee_id IN (${ids})
      AND (
        (e.provider_id = r.reviewee_id AND r.reviewer_id = e.client_id)
        OR (e.client_id = r.reviewee_id AND r.reviewer_id = e.provider_id)
      )
      AND ${publishedReviewSql(asOf)}
    `;
    const [rows, starRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          user_id: string;
          role: string | null;
          review_count: number;
          average: Prisma.Decimal | number | null;
        }>
      >`
        SELECT user_id,
               role,
               COUNT(*)::int AS review_count,
               ROUND(AVG(rating)::numeric, 1) AS average
        FROM (
          SELECT r.reviewee_id::text AS user_id,
                 r.rating::int AS rating,
                 CASE
                   WHEN e.provider_id = r.reviewee_id AND r.reviewer_id = e.client_id
                     THEN 'provider'
                   ELSE 'client'
                 END AS role
          FROM engagement_reviews r
          JOIN work_engagements e ON e.id = r.engagement_id
          WHERE ${receivedWhere}
        ) received
        GROUP BY GROUPING SETS ((user_id, role), (user_id))
      `,
      this.prisma.$queryRaw<
        Array<{
          user_id: string;
          role: string;
          rating: number;
          review_count: number;
        }>
      >`
        SELECT r.reviewee_id::text AS user_id,
               CASE
                 WHEN e.provider_id = r.reviewee_id AND r.reviewer_id = e.client_id
                   THEN 'provider'
                 ELSE 'client'
               END AS role,
               r.rating::int AS rating,
               COUNT(*)::int AS review_count
        FROM engagement_reviews r
        JOIN work_engagements e ON e.id = r.engagement_id
        WHERE ${receivedWhere}
        GROUP BY 1, 2, 3
      `,
    ]);
    for (const id of userIds) {
      result.set(id, {
        overall: emptyUserAggregate(),
        asProvider: emptyUserAggregate(),
        asClient: emptyUserAggregate(),
      });
    }
    for (const row of rows) {
      const current = result.get(row.user_id);
      if (!current) continue;
      const aggregate = toUserAggregate(row.review_count, row.average);
      if (row.role == null) current.overall = aggregate;
      else if (row.role === 'provider') current.asProvider = aggregate;
      else current.asClient = aggregate;
    }
    for (const row of starRows) {
      const current = result.get(row.user_id);
      if (!current) continue;
      const bucket = row.role === 'provider' ? current.asProvider : current.asClient;
      addStarCount(bucket, row.rating, row.review_count);
      addStarCount(current.overall, row.rating, row.review_count);
    }
    return result;
  }

  async summarizeServices(
    serviceIds: string[],
    asOf: Date,
  ): Promise<Map<string, ReviewAggregate>> {
    const result = new Map<string, ReviewAggregate>();
    if (serviceIds.length === 0) return result;
    for (const id of serviceIds) result.set(id, { ...EMPTY_AGGREGATE });
    const rows = await this.prisma.$queryRaw<
      Array<{
        service_id: string;
        review_count: number;
        average: Prisma.Decimal | number | null;
      }>
    >`
      SELECT e.service_offering_id::text AS service_id,
             COUNT(*)::int AS review_count,
             ROUND(AVG(r.rating)::numeric, 1) AS average
      FROM engagement_reviews r
      JOIN work_engagements e ON e.id = r.engagement_id
      WHERE e.service_offering_id IN (${Prisma.join(serviceIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND ${serviceReviewSql()}
        AND ${publishedReviewSql(asOf)}
      GROUP BY 1
    `;
    for (const row of rows) {
      result.set(row.service_id, toAggregate(row.review_count, row.average));
    }
    return result;
  }

  contextLabel(review: ListedReview): string {
    return publicReviewLabel(review.engagement);
  }

  private async pageReviews(input: {
    cursor: SaveCursor | null;
    limit: number;
    where: Prisma.Sql;
  }): Promise<ReviewPage> {
    const cursorSql = input.cursor
      ? Prisma.sql`(
          r.created_at < ${new Date(input.cursor.createdAt)}
          OR (
            r.created_at = ${new Date(input.cursor.createdAt)}
            AND r.id < ${input.cursor.id}::uuid
          )
        )`
      : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT r.id
      FROM engagement_reviews r
      JOIN work_engagements e ON e.id = r.engagement_id
      WHERE ${input.where}
        AND ${cursorSql}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${input.limit + 1}
    `;
    const page = rows.slice(0, input.limit);
    const ids = page.map((row) => row.id);
    if (ids.length === 0) return { items: [], nextCursor: null };
    const items = await this.prisma.engagementReview.findMany({
      where: { id: { in: ids } },
      include: reviewInclude,
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const hasMore = rows.length > input.limit;
    const last = ordered[ordered.length - 1];
    return {
      items: ordered,
      nextCursor:
        hasMore && last ? encodeSaveCursor(last.createdAt, last.id) : null,
    };
  }

  private async finishSubmit(
    reviewId: string,
    engagementId: string,
    revieweeId: string,
  ) {
    const review = await this.prisma.engagementReview.findUniqueOrThrow({
      where: { id: reviewId },
      include: { media: { orderBy: { position: 'asc' } } },
    });
    const counterpart = await this.prisma.engagementReview.findFirst({
      where: { engagementId, reviewerId: revieweeId },
      include: { media: { orderBy: { position: 'asc' } } },
    });
    return { review, counterpart };
  }
}

export { EMPTY_REVIEW_SUMMARY } from './review-summary';

function toAggregate(
  count: number,
  average: Prisma.Decimal | number | null,
): ReviewAggregate {
  if (!count) return { ...EMPTY_AGGREGATE };
  const value = average == null ? null : Number(average);
  return {
    count,
    average: value == null || Number.isNaN(value) ? null : value,
  };
}

function toUserAggregate(
  count: number,
  average: Prisma.Decimal | number | null,
): ReviewAggregate {
  return { ...toAggregate(count, average), stars: [0, 0, 0, 0, 0] };
}

function addStarCount(
  aggregate: ReviewAggregate,
  rating: number,
  count: number,
): void {
  if (!aggregate.stars) aggregate.stars = [0, 0, 0, 0, 0];
  if (rating >= 1 && rating <= 5) aggregate.stars[rating - 1] += count;
}
