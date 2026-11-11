import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261112120000_review_visibility/migration.sql'),
  'utf8',
);

describe('review visibility migration', () => {
  it('adds the hide flag and audit link without rewriting reviews', () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'review_hidden'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'review_restored'");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "staff_hidden_at"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "moderation_version"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "target_review_id"');
    expect(sql).not.toMatch(/\bUPDATE\s+engagement_reviews\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+payments\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
