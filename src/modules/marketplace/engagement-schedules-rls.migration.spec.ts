import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = '20261102152000_engagement_schedules_rls';

function sqlStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

describe('engagement schedules RLS migration', () => {
  const root = join(__dirname, '../../../prisma/migrations', MIGRATION);
  const sql = readFileSync(join(root, 'migration.sql'), 'utf8');
  const statements = sqlStatements(sql);

  it('bounds the lock wait and then enables RLS only', () => {
    expect(statements).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL statement_timeout = '30s'",
      'ALTER TABLE public.engagement_schedules ENABLE ROW LEVEL SECURITY',
      'COMMIT',
    ]);
    const body = statements.join('\n');
    expect(body).not.toMatch(/\bSET\s+(?!LOCAL\b)/i);
    expect(body).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(body).not.toMatch(
      /\b(GRANT|REVOKE|CREATE POLICY|ALTER ROLE|ALTER DATABASE|DROP|INSERT|UPDATE|DELETE)\b/i,
    );
  });

  it('keeps the existing EngagementSchedule mapping and a single migration name', () => {
    const schema = readFileSync(
      join(__dirname, '../../../prisma/schema.prisma'),
      'utf8',
    );
    expect(schema).toMatch(
      /model EngagementSchedule \{[\s\S]*@@map\("engagement_schedules"\)/,
    );
    const migrations = readdirSync(
      join(__dirname, '../../../prisma/migrations'),
    );
    expect(
      migrations.filter((name) => name.includes('engagement_schedules_rls')),
    ).toEqual([MIGRATION]);
  });
});
