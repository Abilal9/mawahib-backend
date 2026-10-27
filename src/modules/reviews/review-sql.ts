import { Prisma } from '@prisma/client';

/**
 * A review row `r` joined to engagement `e` is public at the bound `asOf`.
 * Counterpart means the other engagement participant has a review on `e`.
 */
export function publishedReviewSql(asOf: Date): Prisma.Sql {
  return Prisma.sql`
    e.deleted_at IS NULL
    AND e.review_window_closes_at IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM engagement_reviews counterpart
        WHERE counterpart.engagement_id = r.engagement_id
          AND counterpart.reviewer_id = CASE
            WHEN r.reviewer_id = e.client_id THEN e.provider_id
            ELSE e.client_id
          END
      )
      OR ${asOf} >= e.review_window_closes_at
    )
  `;
}

export function providerReceivedSql(): Prisma.Sql {
  return Prisma.sql`
    e.provider_id = r.reviewee_id
    AND r.reviewer_id = e.client_id
  `;
}

export function clientReceivedSql(): Prisma.Sql {
  return Prisma.sql`
    e.client_id = r.reviewee_id
    AND r.reviewer_id = e.provider_id
  `;
}

export function serviceReviewSql(): Prisma.Sql {
  return Prisma.sql`
    e.service_offering_id IS NOT NULL
    AND r.reviewer_id = e.client_id
    AND r.reviewee_id = e.provider_id
  `;
}

/** Provider-received published aggregate for explore talent ranking. */
export function providerRatingLateral(asOf: Date): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        AVG(r.rating) AS average,
        COUNT(*)::int AS review_count
      FROM engagement_reviews r
      JOIN work_engagements e ON e.id = r.engagement_id
      WHERE r.reviewee_id = u.id
        AND ${providerReceivedSql()}
        AND ${publishedReviewSql(asOf)}
    ) provider_rating ON TRUE
  `;
}

/** Service-level published client→provider aggregate for explore service order. */
export function serviceRatingLateral(asOf: Date): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        AVG(r.rating) AS average,
        COUNT(*)::int AS review_count
      FROM engagement_reviews r
      JOIN work_engagements e ON e.id = r.engagement_id
      WHERE e.service_offering_id = so.id
        AND ${serviceReviewSql()}
        AND ${publishedReviewSql(asOf)}
    ) service_rating ON TRUE
  `;
}
