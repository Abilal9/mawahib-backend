import { readFileSync } from 'fs';
import { join } from 'path';

describe('staff membership migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../prisma/migrations/20261104201000_staff_membership/migration.sql',
    ),
    'utf8',
  );

  it('enables RLS, revokes Data API access, and does not force RLS or add policies', () => {
    for (const table of [
      'auth_subject_reservations',
      'staff_members',
      'staff_audit_events',
    ]) {
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`,
      );
      expect(sql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/BYPASSRLS/i);
    expect(sql).not.toMatch(/REFERENCES\s+"users"/i);
  });
});
