import { readFileSync } from 'fs';
import { join } from 'path';

describe('account deletion request migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20261116120000_account_deletion_request/migration.sql'),
    'utf8',
  );

  it('adds the request table without rewriting users or marketplace rows', () => {
    expect(sql).toContain('CREATE TABLE "account_deletion_requests"');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('account_deletion_requests_one_pending_per_user');
    expect(sql).not.toMatch(/\bUPDATE\s+"?users"?/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"?work_engagements"?/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"?payments"?/i);
  });
});
