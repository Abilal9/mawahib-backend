import { readFileSync } from 'fs';
import { join } from 'path';

describe('double-blind review migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../prisma/migrations/20261027233000_double_blind_reviews/migration.sql',
    ),
    'utf8',
  );

  it('backfills completion from the earliest completion event and stores a 14-day deadline', () => {
    expect(sql).toContain('MIN(created_at) AS completed_at');
    expect(sql).toContain("to_status = 'completed'");
    expect(sql).toContain("completed_at\" + interval '14 days'");
    expect(sql).not.toContain('updated_at');
    expect(sql).not.toMatch(/CURRENT_TIMESTAMP|now\(\)/);
    expect(sql).toContain(
      'completed engagement has no completion event and no completed_at',
    );
    expect(sql).toContain(
      'completed engagement is missing completed_at or review_window_closes_at',
    );
  });

  it('derives the reviewee and aborts unsafe review rows', () => {
    expect(sql).toContain(
      'WHEN r.reviewer_id = e.client_id THEN e.provider_id',
    );
    expect(sql).toContain(
      'WHEN r.reviewer_id = e.provider_id THEN e.client_id',
    );
    expect(sql).toContain('review reviewer is not an engagement participant');
    expect(sql).toContain(
      'review reviewee could not be derived or is a self-review',
    );
    expect(sql).toContain(
      'review parties are not the two engagement participants',
    );
    expect(sql).toContain('review rating is outside 1..5');
    expect(sql).toContain('review belongs to a non-completed engagement');
  });

  it('keeps review history, drops stored averages, and leaves PostgREST locked', () => {
    expect(sql.match(/ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(sql).toContain(
      'engagement_reviews_engagement_id_reviewee_id_key',
    );
    expect(sql).toContain('engagement_reviews_rating_range_check');
    expect(sql).toContain('engagement_reviews_distinct_parties_check');
    expect(sql).toContain('work_engagements_completed_timestamps_check');
    expect(sql).toContain('ALTER TABLE "users" DROP COLUMN "rating_avg"');
    expect(sql).toContain('ALTER TABLE "users" DROP COLUMN "rating_count"');
    expect(sql).toContain(
      'ALTER TABLE "service_offerings" DROP COLUMN "rating_avg"',
    );
    expect(sql).toContain(
      'ALTER TABLE "service_offerings" DROP COLUMN "rating_count"',
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.engagement_reviews FROM anon, authenticated;',
    );
    expect(sql).toContain(
      'ALTER TABLE public.engagement_reviews ENABLE ROW LEVEL SECURITY;',
    );
    expect(sql).not.toContain('CREATE POLICY');
    expect(sql).not.toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).not.toContain('ON DELETE CASCADE');
  });
});

describe('completed seed rows satisfy the timestamp check', () => {
  const seed = readFileSync(
    join(__dirname, '../../../prisma/seed/marketplace.ts'),
    'utf8',
  );

  it('stores completedAt and the 14-day deadline from the completion event', () => {
    expect(seed).toContain('reviewWindowClosesAt');
    expect(seed).toContain('14 * 24 * 60 * 60 * 1000');
    expect(seed).toContain('is completed without a completion event');
  });
});
