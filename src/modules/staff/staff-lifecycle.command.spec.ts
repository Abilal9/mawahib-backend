import { spawnSync } from 'child_process';
import { StaffMembershipStatus } from '@prisma/client';
import { executeStaffLifecycle, prepareLiveConnection } from './staff-lifecycle.command';
import type { MembershipStore } from './staff-lifecycle';

const env = {
  DATABASE_URL: 'postgresql://app:secret-pass@db.example.supabase.co:5432/postgres',
  STAFF_SUPABASE_URL: 'https://rjqazivpwvhztgfbqjkq.supabase.co',
  STAFF_SUPABASE_SECRET_KEY: 'sb_secret_staff',
  STAFF_INVITE_REDIRECT_URL: 'https://admin.mawahib.io',
  PATH: process.env.PATH,
};

const args = [
  'invite',
  '--email',
  'person@example.com',
  '--confirm',
  '--expected-database-host',
  'db.example.supabase.co',
  '--expected-staff-project',
  'rjqazivpwvhztgfbqjkq',
];

describe('staff lifecycle command entry', () => {
  it('validates targets and does not construct a client without connect', async () => {
    const factory = jest.fn();
    const result = await executeStaffLifecycle(args, env, { factory });
    expect(result).toMatchObject({ exitCode: 0, body: { outcome: 'validated', connected: false, provenance: 'unverified-local-process' } });
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret-pass');
    expect(JSON.stringify(result)).not.toContain('sb_secret_staff');
  });

  it('refuses a secret argument and a mismatched database before any factory call', async () => {
    const factory = jest.fn();
    const secret = await executeStaffLifecycle([...args, '--subject', env.DATABASE_URL], env, { factory });
    expect(secret.exitCode).toBe(1);
    expect(secret.body).toEqual({ outcome: 'refused', reason: 'secret-in-argument' });
    const mismatch = await executeStaffLifecycle(
      args.map((item) => (item === 'db.example.supabase.co' ? '127.0.0.1' : item)),
      env,
      { factory },
    );
    expect(mismatch).toMatchObject({ exitCode: 4, body: { outcome: 'refused', reason: 'database-target' } });
    expect(factory).not.toHaveBeenCalled();
    expect(() =>
      prepareLiveConnection(env, { databaseHost: '127.0.0.1', staffProjectRef: 'rjqazivpwvhztgfbqjkq' }),
    ).toThrow(/application database/);
  });

  it('uses an injected driver for a real invite and reports an uncertain send', async () => {
    const store = memoryStore();
    let sends = 0;
    const factory = jest.fn(async () => ({
      issuer: 'https://rjqazivpwvhztgfbqjkq.supabase.co/auth/v1',
      operator: { unverifiedProcessUser: 'local-operator' },
      directory: {
        findByEmail: async () => null,
        invite: async () => {
          sends += 1;
          return 'uncertain' as const;
        },
        readIdentity: async () => ({ id: '33333333-3333-4333-8333-333333333333', email: 'person@example.com' }),
        hasVerifiedTotp: async () => false,
        revokeAccess: async () => 'not-revoked' as const,
        removeVerifiedTotp: async () => 'ok' as const,
        sendPasswordRecovery: async () => 'sent' as const,
      },
      store,
    }));
    const result = await executeStaffLifecycle([...args, '--send', '--connect'], env, { factory });
    expect(result.exitCode).toBe(3);
    expect(result.body).toMatchObject({ outcome: 'uncertain' });
    expect(sends).toBe(1);
    expect(store.rows).toHaveLength(0);
    const retry = await executeStaffLifecycle([...args, '--connect'], env, { factory });
    expect(retry.body).toMatchObject({ outcome: 'unresolved' });
    expect(sends).toBe(1);
  });

  it('the script entry refuses to run with no operation and does not print the environment', () => {
    const result = spawnSync(process.execPath, ['scripts/staff-lifecycle.js'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('unknown-operation');
    expect(`${result.stdout}${result.stderr}`).not.toContain('secret-pass');
    expect(`${result.stdout}${result.stderr}`).not.toContain('sb_secret_staff');
  });
});

function memoryStore(): MembershipStore & { rows: Array<{ status: StaffMembershipStatus }> } {
  const rows: Array<{ id: string; issuer: string; subjectId: string; status: StaffMembershipStatus; invitedEmail: string | null }> = [];
  return {
    rows,
    async find() {
      return null;
    },
    async recordPending() {
      return 'created';
    },
    async changeStatus() {
      return 'missing';
    },
    async latestAction() {
      return null;
    },
  };
}
