import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261111150000_dispute_resolution/migration.sql'),
  'utf8',
);

describe('dispute resolution migration', () => {
  it('adds outcomes and the resulting engagement status without rewriting rows', () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'returned_for_client_review'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'further_work_agreed'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'follow_up_recorded'");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "engagement_resulting_status"');
    expect(sql).not.toMatch(/\bUPDATE\s+work_engagements\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+payments\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+invoices\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toContain('DROP ');
  });
});
