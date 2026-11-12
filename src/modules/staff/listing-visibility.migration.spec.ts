import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261112140000_listing_visibility/migration.sql'),
  'utf8',
);

describe('listing visibility migration', () => {
  it('adds independent staff visibility without rewriting listings or work', () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'job_hidden'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'job_restored'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'service_hidden'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'service_restored'");
    expect(sql).toContain('ALTER TABLE "job_listings" ADD COLUMN IF NOT EXISTS "staff_hidden_at"');
    expect(sql).toContain('ALTER TABLE "service_offerings" ADD COLUMN IF NOT EXISTS "staff_hidden_at"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "target_job_listing_id"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "target_service_offering_id"');
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
