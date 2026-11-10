import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261110170000_dispute_cases/migration.sql'),
  'utf8',
);

describe('dispute case migration', () => {
  it('adds the case tables without rewriting existing data or audit actions', () => {
    expect(sql).toContain('CREATE TYPE "DisputeCaseStatus" AS ENUM');
    expect(sql).not.toContain('ALTER TYPE "StaffAuditAction"');
    expect(sql).toContain('CREATE TABLE "dispute_cases"');
    expect(sql).toContain('CREATE TABLE "dispute_case_events"');
    expect(sql).toContain('CONSTRAINT "dispute_cases_closed_fields_check"');
    expect(sql).toContain('CONSTRAINT "dispute_cases_event_origin_check"');
    expect(sql).toContain('CONSTRAINT "dispute_case_events_note_check"');
    expect(sql).toContain('CREATE UNIQUE INDEX "dispute_cases_one_latest_per_engagement"');
    expect(sql).toContain('WHEN (NEW.to_status = \'disputed\')');
    expect(sql.indexOf('CREATE TRIGGER engagement_events_open_dispute_case')).toBeLessThan(
      sql.indexOf('SELECT gen_random_uuid(), e.id'),
    );
    expect(sql).toContain("WHERE e.status = 'disputed'");
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM dispute_cases c WHERE c.engagement_id = e.id)');
    expect(sql).toContain('CREATE TRIGGER dispute_case_events_append_only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON dispute_case_events');
    expect(sql).toContain('REVOKE ALL ON TABLE public.dispute_cases FROM anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON TABLE public.dispute_case_events FROM anon, authenticated');
    expect(sql).toContain('ALTER TABLE public.dispute_cases ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.dispute_case_events ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/\bUPDATE\s+work_engagements\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toContain('DROP ');
    expect(sql).not.toContain('ALTER TABLE "work_engagements"');
  });
});
