/**
 * Disposable local PostgreSQL acceptance for the staff migrations.
 *
 * This file is not part of the Jest suite. It refuses any database other than
 * the loopback container started below. It does not read project credentials
 * into the test URL and it does not call Supabase, Storage, email, or payments.
 *
 * Run from the backend repository with the installed toolchain:
 *   node node_modules/ts-node/dist/bin.js --transpile-only scripts/staff-acceptance/run.ts
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AccountStatus, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  SELF_ACTION_FORBIDDEN,
  STAFF_ACCESS_DENIED,
} from '../../src/common/auth/admission.codes';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { AccountStatusService } from '../../src/modules/staff/account-status.service';
import { StaffMembershipService } from '../../src/modules/staff/staff-membership.service';
import {
  resetStaffMembershipSchemaCache,
  staffMembershipSchemaReady,
} from '../../src/modules/staff/staff-schema';

const IMAGE = 'postgres:15.14';
const CONTAINER = 'mawahib-staff-acceptance';
const VOLUME = 'mawahib-staff-acceptance-data';
const HOST = '127.0.0.1';
const PORT = 55432;
const SUPERUSER = 'mawahib_acceptance';
const SUPERUSER_PASSWORD = 'mawahib-staff-acceptance-local';
const APP_ROLE = 'mawahib_app';
const APP_PASSWORD = 'mawahib-staff-app-local';
const HAPPY = 'mawahib_staff_acceptance';
const REPO_ROOT = process.cwd();
const PRISMA_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'prisma');
const ISSUER_MIGRATION = '20261106041000_staff_issuer_membership';
const PRODUCT_ISSUER = 'https://staff-acceptance.invalid/product/auth/v1';
const STAFF_ISSUER = 'https://staff-acceptance.invalid/staff/auth/v1';
const OTHER_ISSUER = 'https://staff-acceptance.invalid/other/auth/v1';

const clients: PrismaClient[] = [];
const observedRefusals: string[] = [];

function assertExerciseIdentity(): void {
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  if (HOST !== '127.0.0.1' || PORT !== 55432) {
    throw new Error('Refusing a target that is not the loopback disposable port.');
  }
  if (CONTAINER !== 'mawahib-staff-acceptance' || VOLUME !== 'mawahib-staff-acceptance-data') {
    throw new Error('Refusing container or volume names that do not belong to this exercise.');
  }
  if (IMAGE !== 'postgres:15.14') throw new Error('Refusing an unexpected PostgreSQL image.');
  if (!existsSync(PRISMA_BIN)) throw new Error('The installed Prisma binary is missing.');
  if (!existsSync('.env')) return;
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((item) => item.startsWith('DATABASE_URL='));
  if (!line) return;
  const raw = line.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
  const parsed = new URL(raw);
  if (
    parsed.hostname === HOST &&
    (parsed.port === String(PORT) || parsed.pathname.includes('mawahib_staff_acceptance'))
  ) {
    throw new Error('Project .env overlaps the disposable target. Refusing to continue.');
  }
}

function databaseUrl(database: string): string {
  if (!/^mawahib_staff_acceptance(_[a-z]+)*$/.test(database)) {
    throw new Error('Refusing an unexpected database name.');
  }
  const url = `postgresql://${APP_ROLE}:${APP_PASSWORD}@${HOST}:${PORT}/${database}?connection_limit=1`;
  const parsed = new URL(url);
  if (parsed.protocol !== 'postgresql:') throw new Error('Refusing a non-PostgreSQL URL.');
  if (parsed.hostname !== HOST || parsed.port !== String(PORT)) {
    throw new Error('Refusing a database that is not the loopback disposable target.');
  }
  if (parsed.username !== APP_ROLE || parsed.password !== APP_PASSWORD) {
    throw new Error('Refusing unexpected acceptance credentials.');
  }
  if (parsed.pathname !== `/${database}`) throw new Error('Refusing an unexpected database path.');
  const lowered = url.toLowerCase();
  for (const banned of ['supabase', 'amazonaws', 'pooler', 'railway', 'neon.tech']) {
    if (lowered.includes(banned)) throw new Error('Refusing a hosted database URL.');
  }
  return url;
}

function isolatedEnv(url: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { DATABASE_URL: url };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'USER', 'LOGNAME']) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function isolatedCwd(): string {
  const root = join(tmpdir(), 'mawahib-staff-acceptance-cwd');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'mawahib-staff-acceptance-isolated', private: true }),
  );
  rmSync(join(root, '.env'), { force: true });
  return root;
}

function redact(text: string): string {
  return text.replaceAll(SUPERUSER_PASSWORD, '[redacted]').replaceAll(APP_PASSWORD, '[redacted]');
}

function run(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: env ?? process.env,
    cwd,
  });
  const output = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed\n${output}`);
  }
  return output.trim();
}

function psql(database: string, sql: string): string {
  if (database !== 'postgres') databaseUrl(database);
  return run('docker', [
    'exec',
    '-i',
    CONTAINER,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    SUPERUSER,
    '-d',
    database,
    '-t',
    '-A',
    '-c',
    sql,
  ]).trim();
}

function migrate(database: string, schema: string): string {
  const url = databaseUrl(database);
  const schemaPath = schema.startsWith('/') ? schema : join(REPO_ROOT, schema);
  const output = run(
    PRISMA_BIN,
    ['migrate', 'deploy', '--schema', schemaPath],
    isolatedEnv(url),
    isolatedCwd(),
  );
  if (output.includes('Environment variables loaded from')) {
    throw new Error('Prisma loaded an environment file. Refusing to continue.');
  }
  return output;
}

function openClient(database: string): PrismaService {
  const url = databaseUrl(database);
  const config = {
    get: (key: string) => (key === 'DATABASE_URL' ? url : undefined),
  } as ConfigService;
  const prisma = new PrismaService(config);
  clients.push(prisma);
  return prisma;
}

async function connect(database: string): Promise<PrismaService> {
  const prisma = openClient(database);
  await prisma.$connect();
  const rows = await prisma.$queryRaw<
    Array<{ db: string; role: string; superuser: boolean; bypass: boolean }>
  >`
    SELECT current_database() AS db,
           current_user AS role,
           rolsuper AS superuser,
           rolbypassrls AS bypass
    FROM pg_roles
    WHERE rolname = current_user
  `;
  if (rows[0]?.db !== database || rows[0]?.role !== APP_ROLE || rows[0]?.superuser || !rows[0]?.bypass) {
    throw new Error('Connected role does not match the disposable non-superuser application role.');
  }
  return prisma;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return undefined;
  const response = (error as { getResponse: () => unknown }).getResponse();
  if (!response || typeof response !== 'object' || !('code' in response)) return undefined;
  return String((response as { code: unknown }).code);
}

async function main(): Promise<void> {
  assertExerciseIdentity();
  const binding = run('docker', [
    'inspect',
    '--format',
    '{{json .HostConfig.PortBindings}}',
    CONTAINER,
  ]);
  if (!binding.includes(`"HostIp":"${HOST}"`) || !binding.includes(`"HostPort":"${PORT}"`)) {
    throw new Error('Container port is not bound to loopback only.');
  }
  const image = run('docker', ['inspect', '--format', '{{.Config.Image}}', CONTAINER]).trim();
  assert(image === IMAGE, `Container image is ${image}.`);

  const version = psql(HAPPY, 'SHOW server_version');
  assert(version.startsWith('15.14'), `Server version is ${version}.`);
  const citext = psql(HAPPY, "SELECT extname FROM pg_extension WHERE extname = 'citext'");
  assert(citext === 'citext', 'citext extension is missing.');
  const owner = psql(
    HAPPY,
    `SELECT r.rolname || '|' || r.rolsuper::text || '|' || r.rolbypassrls::text
     FROM pg_class c
     JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.relname = 'staff_members'`,
  );
  assert(owner === `${APP_ROLE}|false|true`, `Staff tables are owned by ${owner}.`);

  const applied = psql(
    HAPPY,
    `SELECT migration_name || '|' || (finished_at IS NOT NULL) || '|' || (rolled_back_at IS NULL)
     FROM _prisma_migrations ORDER BY started_at`,
  );
  const migrationNames = readdirSync('prisma/migrations').filter((name) => name !== 'migration_lock.toml');
  const lines = applied.split('\n').filter(Boolean);
  assert(lines.length === migrationNames.length, `Applied ${lines.length} of ${migrationNames.length} migrations.`);
  assert(lines.every((line) => line.endsWith('|true|true')), 'A migration is unfinished or rolled back.');
  assert(lines.some((line) => line.startsWith(`${ISSUER_MIGRATION}|`)), 'Issuer migration was not recorded.');
  const beforeRerun = psql(HAPPY, 'SELECT count(*)::text || md5(string_agg(finished_at::text, \',\' ORDER BY migration_name)) FROM _prisma_migrations');

  const second = migrate(HAPPY, 'prisma/schema.prisma');
  assert(second.includes('No pending migrations to apply.'), 'Second migrate deploy still had pending work.');
  const afterRerun = psql(HAPPY, 'SELECT count(*)::text || md5(string_agg(finished_at::text, \',\' ORDER BY migration_name)) FROM _prisma_migrations');
  assert(beforeRerun === afterRerun, 'Re-running migrate deploy changed migration history.');

  const shape = psql(
    HAPPY,
    `SELECT
      (to_regclass('public.auth_subject_reservations') IS NULL)
      AND (to_regtype('"AuthSubjectKind"') IS NULL)
      AND EXISTS (
        SELECT 1 FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class tbl ON tbl.oid = i.indrelid
        WHERE tbl.relname = 'staff_members' AND idx.relname = 'staff_members_issuer_subject_id_key'
          AND i.indisunique AND i.indisvalid
      )
      AND EXISTS (
        SELECT 1 FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class tbl ON tbl.oid = i.indrelid
        WHERE tbl.relname = 'staff_members' AND idx.relname = 'staff_members_linked_product_user_id_key'
          AND i.indisunique AND i.indisvalid
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'staff_members_linked_product_user_id_fkey' AND confdeltype = 'n' AND convalidated
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'staff_audit_events_actor_staff_member_id_fkey' AND confdeltype = 'r' AND convalidated
      )
      AND EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'staff_audit_events_actor_staff_member_id_idx'
      )`,
  );
  assert(shape === 't', 'Final staff constraints or indexes do not match.');

  const security = psql(
    HAPPY,
    `SELECT bool_and(c.relrowsecurity) AND bool_and(NOT c.relforcerowsecurity)
       AND NOT EXISTS (
         SELECT 1 FROM pg_policy p
         JOIN pg_class c2 ON c2.oid = p.polrelid
         WHERE c2.relname IN ('staff_members', 'staff_audit_events')
       )
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('staff_members', 'staff_audit_events')`,
  );
  assert(security === 't', 'Staff RLS or policies do not match the backend-only design.');

  let anonDenied = false;
  try {
    psql(HAPPY, 'SET ROLE anon; SELECT 1 FROM public.staff_members');
  } catch (error) {
    anonDenied = String(error).includes('permission denied');
  }
  let authenticatedDenied = false;
  try {
    psql(
      HAPPY,
      `SET ROLE authenticated; INSERT INTO public.staff_members (id, issuer, subject_id, updated_at)
       VALUES (gen_random_uuid(), 'x', gen_random_uuid(), now())`,
    );
  } catch (error) {
    authenticatedDenied = String(error).includes('permission denied');
  }
  assert(anonDenied && authenticatedDenied, 'anon or authenticated could access staff tables.');

  psql(
    HAPPY,
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mawahib_rls_probe') THEN
         CREATE ROLE mawahib_rls_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
       END IF;
     END $$;
     GRANT SELECT, INSERT ON public.staff_members TO mawahib_rls_probe;
     GRANT SELECT, INSERT ON public.staff_audit_events TO mawahib_rls_probe`,
  );
  const visibleToProbe = psql(
    HAPPY,
    'SET ROLE mawahib_rls_probe; SELECT count(*) FROM public.staff_members',
  );
  assert(visibleToProbe.endsWith('0'), 'A non-owner with SELECT could see staff rows through RLS.');
  let rlsStoppedWrite = false;
  try {
    psql(
      HAPPY,
      `SET ROLE mawahib_rls_probe; INSERT INTO public.staff_members (id, issuer, subject_id, updated_at)
       VALUES (gen_random_uuid(), 'probe', gen_random_uuid(), now())`,
    );
  } catch (error) {
    rlsStoppedWrite = String(error).includes('row-level security');
  }
  psql(
    HAPPY,
    `REVOKE ALL ON public.staff_members FROM mawahib_rls_probe;
     REVOKE ALL ON public.staff_audit_events FROM mawahib_rls_probe`,
  );
  assert(rlsStoppedWrite, 'A non-owner with table grants was not stopped by RLS.');

  const prisma = await connect(HAPPY);
  resetStaffMembershipSchemaCache();
  assert(await staffMembershipSchemaReady(prisma), 'Schema readiness rejected the migrated schema.');

  const subject = randomUUID();
  const operator = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `operator-${randomUUID()}@staff-acceptance.invalid`,
      username: `operator_${randomUUID().slice(0, 8)}`,
      displayName: 'Operator',
      accountType: 'talent',
    },
  });
  const other = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `other-${randomUUID()}@staff-acceptance.invalid`,
      username: `other_${randomUUID().slice(0, 8)}`,
      displayName: 'Other employee',
      accountType: 'business',
    },
  });
  const linked = await prisma.staffMember.create({
    data: {
      issuer: STAFF_ISSUER,
      subjectId: subject,
      status: 'active',
      linkedProductUserId: operator.id,
    },
  });
  await prisma.staffMember.create({
    data: {
      issuer: OTHER_ISSUER,
      subjectId: subject,
      status: 'pending',
    },
  });
  const membership = new StaffMembershipService(prisma);
  const admitted = await membership.findForAdmission(STAFF_ISSUER, subject);
  const otherRealm = await membership.findForAdmission(OTHER_ISSUER, subject);
  assert(admitted?.id === linked.id && admitted.status === 'active', 'Issuer lookup missed the active membership.');
  assert(otherRealm?.status === 'pending' && otherRealm.id !== linked.id, 'The same subject crossed issuers.');
  assert(
    (await membership.findForAdmission(PRODUCT_ISSUER, subject)) === null,
    'An absent issuer returned a membership.',
  );

  const service = new AccountStatusService(prisma);
  const actor = { issuer: STAFF_ISSUER, subjectId: subject };
  let selfFailed = false;
  try {
    await service.change(actor, operator.id, {
      status: AccountStatus.SUSPENDED,
      expectedStatus: AccountStatus.ACTIVE,
      reason: 'self',
    });
  } catch (error) {
    selfFailed = codeOf(error) === SELF_ACTION_FORBIDDEN;
  }
  assert(selfFailed, 'Self-action was not rejected.');
  assert(
    (await prisma.user.findUnique({ where: { id: operator.id } }))?.accountStatus === 'ACTIVE',
    'Self-action changed the linked account.',
  );

  const changed = await service.change(actor, other.id, {
    status: AccountStatus.SUSPENDED,
    expectedStatus: AccountStatus.ACTIVE,
    reason: 'review',
  });
  assert(changed.outcome === 'changed' && changed.accountStatus === 'SUSPENDED', 'Other-account suspension did not commit.');
  const audit = await prisma.staffAuditEvent.findFirst({
    where: { targetAccountId: other.id, action: 'account_suspended' },
  });
  assert(
    audit?.actorStaffMemberId === linked.id && audit.previousStatus === 'ACTIVE' && audit.resultingStatus === 'SUSPENDED',
    'Suspension audit does not match the status change.',
  );
  const repeated = await service.change(actor, other.id, {
    status: AccountStatus.SUSPENDED,
    expectedStatus: AccountStatus.SUSPENDED,
    reason: 'repeat',
  });
  assert(repeated.outcome === 'unchanged', 'Repeating the same status created another transition.');
  assert(
    (await prisma.staffAuditEvent.count({ where: { targetAccountId: other.id } })) === 1,
    'A repeated action wrote a second audit row.',
  );

  psql(
    HAPPY,
    `CREATE OR REPLACE FUNCTION mawahib_acceptance_reject_audit()
     RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       RAISE EXCEPTION 'synthetic audit failure';
     END $fn$;
     CREATE TRIGGER mawahib_acceptance_reject_audit
     BEFORE INSERT ON staff_audit_events
     FOR EACH ROW EXECUTE FUNCTION mawahib_acceptance_reject_audit()`,
  );
  const restoreTarget = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `restore-${randomUUID()}@staff-acceptance.invalid`,
      username: `restore_${randomUUID().slice(0, 8)}`,
      displayName: 'Restore target',
      accountType: 'talent',
      accountStatus: 'SUSPENDED',
    },
  });
  let auditFailed = false;
  try {
    await service.change(actor, restoreTarget.id, {
      status: AccountStatus.ACTIVE,
      expectedStatus: AccountStatus.SUSPENDED,
      reason: 'audit must roll back',
    });
  } catch {
    auditFailed = true;
  } finally {
    psql(
      HAPPY,
      'DROP TRIGGER mawahib_acceptance_reject_audit ON staff_audit_events; DROP FUNCTION mawahib_acceptance_reject_audit()',
    );
  }
  assert(auditFailed, 'Audit failure did not abort the status change.');
  assert(
    (await prisma.user.findUnique({ where: { id: restoreTarget.id } }))?.accountStatus === 'SUSPENDED',
    'Audit failure left the new status committed.',
  );
  assert(
    (await prisma.staffAuditEvent.count({ where: { targetAccountId: restoreTarget.id } })) === 0,
    'Audit failure left an audit row.',
  );

  const concurrentAccount = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `concurrent-${randomUUID()}@staff-acceptance.invalid`,
      username: `conc_${randomUUID().slice(0, 8)}`,
      displayName: 'Concurrent',
      accountType: 'talent',
    },
  });
  const secondClient = await connect(HAPPY);
  const secondService = new AccountStatusService(secondClient);
  const identical = await Promise.all([
    service.change(actor, concurrentAccount.id, {
      status: AccountStatus.SUSPENDED,
      expectedStatus: AccountStatus.ACTIVE,
      reason: 'same request',
    }),
    secondService.change(actor, concurrentAccount.id, {
      status: AccountStatus.SUSPENDED,
      expectedStatus: AccountStatus.ACTIVE,
      reason: 'same request',
    }),
  ]);
  assert(
    identical.filter((item) => item.outcome === 'changed').length === 1,
    'Concurrent identical requests did not produce one transition.',
  );
  assert(
    (await prisma.user.findUnique({ where: { id: concurrentAccount.id } }))?.accountStatus === 'SUSPENDED',
    'Concurrent identical requests left the account active.',
  );
  assert(
    (await prisma.staffAuditEvent.count({ where: { targetAccountId: concurrentAccount.id } })) === 1,
    'Concurrent identical requests wrote duplicate audits.',
  );

  const opposeAccount = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `oppose-${randomUUID()}@staff-acceptance.invalid`,
      username: `oppose_${randomUUID().slice(0, 8)}`,
      displayName: 'Oppose',
      accountType: 'talent',
    },
  });
  const opposed = await Promise.allSettled([
    service.change(actor, opposeAccount.id, {
      status: AccountStatus.SUSPENDED,
      expectedStatus: AccountStatus.ACTIVE,
      reason: 'suspend',
    }),
    secondService.change(actor, opposeAccount.id, {
      status: AccountStatus.ACTIVE,
      expectedStatus: AccountStatus.SUSPENDED,
      reason: 'restore',
    }),
  ]);
  const opposeAudits = await prisma.staffAuditEvent.findMany({
    where: { targetAccountId: opposeAccount.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const opposeStatus = (await prisma.user.findUnique({ where: { id: opposeAccount.id } }))?.accountStatus;
  let cursor: AccountStatus = AccountStatus.ACTIVE;
  for (const row of opposeAudits) {
    assert(row.previousStatus === cursor, 'Opposing actions left a gap in audit history.');
    assert(row.resultingStatus, 'Audit row has no resulting status.');
    cursor = row.resultingStatus;
  }
  assert(opposeStatus === cursor, 'Final status does not match the audit history.');
  assert(
    opposed.filter((item) => item.status === 'rejected').length <= 1,
    'Both opposing requests failed.',
  );

  const cycle = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `cycle-${randomUUID()}@staff-acceptance.invalid`,
      username: `cycle_${randomUUID().slice(0, 8)}`,
      displayName: 'Cycle',
      accountType: 'talent',
    },
  });
  await service.change(actor, cycle.id, {
    status: AccountStatus.SUSPENDED,
    expectedStatus: AccountStatus.ACTIVE,
    reason: 'cycle suspend',
  });
  await service.change(actor, cycle.id, {
    status: AccountStatus.ACTIVE,
    expectedStatus: AccountStatus.SUSPENDED,
    reason: 'cycle restore',
  });
  const hidden = await service.change(actor, cycle.id, {
    status: AccountStatus.ACTIVE,
    expectedStatus: AccountStatus.ACTIVE,
    reason: 'looks unchanged',
  });
  assert(hidden.outcome === 'unchanged', 'A return to the original status was treated as a new change.');
  assert(
    (await prisma.staffAuditEvent.count({ where: { targetAccountId: cycle.id } })) === 2,
    'The suspend-and-restore cycle was not recorded.',
  );

  const heldAccount = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `held-${randomUUID()}@staff-acceptance.invalid`,
      username: `held_${randomUUID().slice(0, 8)}`,
      displayName: 'Held',
      accountType: 'talent',
    },
  });
  const holder = await connect(HAPPY);
  let release: () => void = () => undefined;
  const locked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deactivation = holder.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM staff_members WHERE id = CAST(${linked.id} AS uuid) FOR UPDATE`;
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await tx.$executeRaw`
      UPDATE staff_members
      SET status = 'inactive'::"StaffMembershipStatus"
      WHERE id = CAST(${linked.id} AS uuid)
    `;
  });
  await locked;
  let deactivated = false;
  const denied = service
    .change(actor, heldAccount.id, {
      status: AccountStatus.SUSPENDED,
      expectedStatus: AccountStatus.ACTIVE,
      reason: 'after deactivation',
    })
    .then(() => false)
    .catch((error: unknown) => codeOf(error) === STAFF_ACCESS_DENIED);
  await deactivation;
  deactivated = await denied;
  assert(deactivated, 'A membership deactivated before the locked read was still accepted.');
  assert(
    (await prisma.user.findUnique({ where: { id: heldAccount.id } }))?.accountStatus === 'ACTIVE',
    'The denied action still changed the account.',
  );

  await prisma.user.delete({ where: { id: operator.id } });
  const unlinked = await prisma.staffMember.findUnique({ where: { id: linked.id } });
  assert(unlinked?.linkedProductUserId === null, 'Deleting the product account did not clear the link.');
  await prisma.staffAuditEvent.deleteMany({ where: { actorStaffMemberId: linked.id } });
  const replacement = await prisma.staffMember.create({
    data: { issuer: STAFF_ISSUER, subjectId: randomUUID(), status: 'active' },
  });
  await prisma.staffAuditEvent.create({
    data: {
      action: 'account_suspended',
      targetSubjectId: other.id,
      targetAccountId: other.id,
      actorStaffMemberId: replacement.id,
      previousStatus: 'ACTIVE',
      resultingStatus: 'SUSPENDED',
      reason: 'restrict check',
    },
  });
  let restricted = false;
  try {
    await prisma.staffMember.delete({ where: { id: replacement.id } });
  } catch {
    restricted = true;
  }
  assert(restricted, 'An audit reference did not restrict staff deletion.');
  assert(
    (await prisma.staffMember.findUnique({ where: { id: replacement.id } })) !== null,
    'The restricted delete removed the staff row.',
  );

  console.log(
    JSON.stringify(
      {
        serverVersion: version,
        migrations: lines.length,
        issuerRecorded: true,
        secondDeploy: 'no pending migrations',
        schemaReady: true,
        applicationRole: 'non-superuser owner with BYPASSRLS',
        hostedRoleParity: false,
        observedRefusals,
        anonAndAuthenticated: 'denied',
        rlsProbe: 'hidden',
        selfAction: 'rejected',
        otherAccount: 'suspended with one audit',
        auditRollback: 'status unchanged',
        concurrentIdentical: 'one transition',
        opposingAudits: opposeAudits.length,
        opposingFinalStatus: opposeStatus,
        hiddenCycleDetectedByExpectedStatus: false,
        deactivationBeforeDecision: 'denied',
        productDeleteClearsLink: true,
        auditRestrictsStaffDelete: true,
      },
      null,
      2,
    ),
  );
}

function removeOwnedResources(): void {
  const users = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `volume=${VOLUME}`, '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).stdout
    ?.split('\n')
    .map((name) => name.trim())
    .filter(Boolean) ?? [];
  if (users.some((name) => name !== CONTAINER)) {
    throw new Error('Refusing to remove a volume used by another container.');
  }
  const existing = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Image}}'],
    { encoding: 'utf8' },
  ).stdout?.trim();
  if (existing && existing !== IMAGE) {
    throw new Error('Refusing to remove a container that does not use this exercise image.');
  }
  if (existing) run('docker', ['rm', '-f', CONTAINER]);
  spawnSync('docker', ['volume', 'rm', VOLUME], { encoding: 'utf8' });
}

async function prepareCluster(): Promise<void> {
  assertExerciseIdentity();
  databaseUrl(HAPPY);
  removeOwnedResources();
  run('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER,
    '--publish',
    `${HOST}:${PORT}:5432`,
    '--volume',
    `${VOLUME}:/var/lib/postgresql/data`,
    '--env',
    `POSTGRES_USER=${SUPERUSER}`,
    '--env',
    `POSTGRES_PASSWORD=${SUPERUSER_PASSWORD}`,
    '--env',
    `POSTGRES_DB=${HAPPY}`,
    IMAGE,
  ]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = spawnSync(
      'docker',
      ['exec', CONTAINER, 'pg_isready', '-U', SUPERUSER, '-d', HAPPY],
      { encoding: 'utf8' },
    );
    if (ready.status === 0) break;
    if (attempt === 29) throw new Error('Disposable PostgreSQL did not become ready.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  psql(
    HAPPY,
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
         CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
         CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
         CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS
           PASSWORD '${APP_PASSWORD}';
       END IF;
     END $$`,
  );
  grantApplicationDatabase(HAPPY);
}

function grantApplicationDatabase(database: string): void {
  psql('postgres', `ALTER DATABASE ${database} OWNER TO ${APP_ROLE}`);
  psql('postgres', `GRANT CONNECT ON DATABASE ${database} TO anon, authenticated`);
  psql(database, `ALTER SCHEMA public OWNER TO ${APP_ROLE}`);
  psql(database, 'GRANT USAGE ON SCHEMA public TO anon, authenticated');
  psql(database, 'CREATE EXTENSION IF NOT EXISTS citext');
}

function partialSchema(): string {
  const root = join(tmpdir(), 'mawahib-staff-acceptance-partial');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'migrations'), { recursive: true });
  cpSync('prisma/schema.prisma', join(root, 'schema.prisma'));
  for (const name of readdirSync('prisma/migrations')) {
    if (name === ISSUER_MIGRATION) continue;
    cpSync(join('prisma/migrations', name), join(root, 'migrations', name), { recursive: true });
  }
  return join(root, 'schema.prisma');
}

async function refuse(database: string, table: 'staff_members' | 'staff_audit_events' | 'auth_subject_reservations'): Promise<void> {
  psql('postgres', `CREATE DATABASE ${database}`);
  grantApplicationDatabase(database);
  const schema = partialSchema();
  migrate(database, schema);
  const marker = randomUUID();
  if (table === 'staff_members') {
    psql(
      database,
      `INSERT INTO staff_members (id, subject_id, role, status, updated_at)
       VALUES ('${marker}', '${randomUUID()}', 'operator', 'pending', now())`,
    );
  } else if (table === 'staff_audit_events') {
    psql(
      database,
      `INSERT INTO staff_audit_events (id, action, target_subject_id, unverified_process_user)
       VALUES ('${marker}', 'membership_pending_recorded', '${randomUUID()}', 'acceptance')`,
    );
  } else {
    psql(
      database,
      `INSERT INTO auth_subject_reservations (subject_id, kind)
       VALUES ('${marker}', 'product')`,
    );
  }
  const failed = spawnSync(
    PRISMA_BIN,
    ['migrate', 'deploy', '--schema', join(REPO_ROOT, 'prisma', 'schema.prisma')],
    { encoding: 'utf8', env: isolatedEnv(databaseUrl(database)), cwd: isolatedCwd() },
  );
  assert(failed.status !== 0, `${table} refusal unexpectedly applied.`);
  const combined = redact(`${failed.stdout ?? ''}\n${failed.stderr ?? ''}`);
  if (combined.includes('Environment variables loaded from')) {
    throw new Error('Prisma loaded an environment file during a refusal check.');
  }
  observedRefusals.push(combined.match(/ERROR: [^\n]+/)?.[0] ?? 'migration command failed');
  const remaining = psql(database, `SELECT count(*) FROM ${table} WHERE ${table === 'auth_subject_reservations' ? 'subject_id' : 'id'} = '${marker}'`);
  assert(remaining === '1', `${table} refusal deleted the synthetic row.`);
  const issuerColumn = psql(
    database,
    `SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'staff_members' AND column_name = 'issuer'`,
  );
  assert(issuerColumn === '0', `${table} refusal left the issuer column in place.`);
  const reservations = psql(database, `SELECT to_regclass('public.auth_subject_reservations') IS NOT NULL`);
  assert(reservations === 't', `${table} refusal dropped auth_subject_reservations.`);
  const finished = psql(
    database,
    `SELECT count(*) FROM _prisma_migrations
     WHERE migration_name = '${ISSUER_MIGRATION}' AND finished_at IS NOT NULL`,
  );
  assert(finished === '0', `${table} refusal recorded a successful issuer migration.`);
}

async function shutdown(): Promise<void> {
  for (const client of clients) {
    await client.$disconnect().catch(() => undefined);
  }
}

async function cleanupContainer(): Promise<void> {
  spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' });
  spawnSync('docker', ['volume', 'rm', VOLUME], { encoding: 'utf8' });
  const names = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).stdout?.trim();
  const volume = spawnSync('docker', ['volume', 'ls', '--filter', `name=^${VOLUME}$`, '--format', '{{.Name}}'], {
    encoding: 'utf8',
  }).stdout?.trim();
  if (names || volume) {
    throw new Error('Disposable container or volume is still present.');
  }
}

async function runAcceptance(): Promise<void> {
  assertExerciseIdentity();
  await prepareCluster();
  migrate(HAPPY, 'prisma/schema.prisma');
  await refuse('mawahib_staff_acceptance_refuse_members', 'staff_members');
  await refuse('mawahib_staff_acceptance_refuse_audit', 'staff_audit_events');
  await refuse('mawahib_staff_acceptance_refuse_reservations', 'auth_subject_reservations');
  await main();
}

runAcceptance()
  .then(async () => {
    await shutdown();
    await cleanupContainer();
    const image = spawnSync('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' });
    console.log(`image-cached ${image.stdout?.trim() ?? 'missing'}`);
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await shutdown();
    await cleanupContainer().catch(() => undefined);
    process.exitCode = 1;
  });
