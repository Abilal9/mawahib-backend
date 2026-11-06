import { createStaffDirectory, type StaffAdminApi } from './staff-lifecycle.directory';
import { createLifecycleStore } from './staff-lifecycle.store';
import {
  activateStaff,
  assertLifecycleTargets,
  deactivateStaff,
  inviteStaff,
  permitReenrollment,
  recoverLostFactor,
  resendInvitation,
  readmitStaff,
  sendPasswordSetup,
  type LifecycleOperator,
  type StaffDirectory,
} from './staff-lifecycle';
import type { MembershipStore } from './staff-lifecycle';

const operations = [
  'invite',
  'resolve-invitation',
  'resend-invitation',
  'activate',
  'deactivate',
  'emergency-deactivate',
  'recover-lost-factor',
  'emergency-recover-lost-factor',
  'permit-reenrollment',
  'send-password-setup',
  'readmit',
] as const;

export type LifecycleOperation = (typeof operations)[number];

const allowedRedirects = new Set(['https://admin.mawahib.io', 'http://127.0.0.1:5174']);

export type LifecyclePorts = {
  issuer: string;
  directory: StaffDirectory;
  store: MembershipStore;
  operator: LifecycleOperator;
  close?: () => Promise<void>;
};

export type CommandResult = {
  exitCode: number;
  body: Record<string, unknown>;
};

type Parsed =
  | { ok: false; exitCode: number; body: Record<string, unknown> }
  | {
      ok: true;
      operation: LifecycleOperation;
      email?: string;
      subjectId?: string;
      confirm: boolean;
      send: boolean;
      connect: boolean;
      acknowledgeIdentityChange: boolean;
      reason?: string;
      expectedDatabaseHost: string;
      expectedStaffProject: string;
    };

/**
 * Reads targets from the environment and compares them before any client is constructed.
 * The returned object never includes the database URL or the staff secret.
 */
export function prepareLiveConnection(
  env: Record<string, string | undefined>,
  expected: { databaseHost: string; staffProjectRef: string },
): { databaseHost: string; staffProjectRef: string; issuer: string; redirectTo: string } {
  const databaseHost = hostOf(env.DATABASE_URL);
  const staffUrl = env.STAFF_SUPABASE_URL?.trim();
  const staffProjectRef = projectRef(staffUrl);
  assertLifecycleTargets({
    databaseHost: databaseHost ?? '',
    expectedDatabaseHost: expected.databaseHost,
    staffProjectRef: staffProjectRef ?? '',
    expectedStaffProjectRef: expected.staffProjectRef,
  });
  if (!env.STAFF_SUPABASE_SECRET_KEY?.trim()) {
    throw new Error('Staff lifecycle commands refuse to connect without the staff secret in the environment.');
  }
  const redirectTo = env.STAFF_INVITE_REDIRECT_URL?.trim() ?? '';
  if (!allowedRedirects.has(redirectTo)) {
    throw new Error('Staff lifecycle commands refuse this invitation redirect.');
  }
  return {
    databaseHost: databaseHost as string,
    staffProjectRef: staffProjectRef as string,
    issuer: `${staffUrl?.replace(/\/+$/, '')}/auth/v1`,
    redirectTo,
  };
}

export async function executeStaffLifecycle(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: { factory?: (prepared: ReturnType<typeof prepareLiveConnection>) => Promise<LifecyclePorts> } = {},
): Promise<CommandResult> {
  const parsed = parseArgs(argv, env);
  if (!parsed.ok) return { exitCode: parsed.exitCode, body: parsed.body };
  let prepared: ReturnType<typeof prepareLiveConnection>;
  try {
    prepared = prepareLiveConnection(env, {
      databaseHost: parsed.expectedDatabaseHost,
      staffProjectRef: parsed.expectedStaffProject,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'refused';
    const exitCode = /database target|staff-auth project/.test(message) ? 4 : 1;
    return { exitCode, body: { outcome: 'refused', reason: publicReason(message) } };
  }
  if (!parsed.connect) {
    return {
      exitCode: 0,
      body: {
        outcome: 'validated',
        connected: false,
        operation: parsed.operation,
        provenance: 'unverified-local-process',
      },
    };
  }
  if (!deps.factory) {
    return { exitCode: 1, body: { outcome: 'refused', reason: 'connection-not-available' } };
  }
  const ports = await deps.factory(prepared);
  try {
    const body = await dispatch(parsed, ports, prepared.issuer);
    return { exitCode: exitCodeFor(body.outcome), body };
  } finally {
    await ports.close?.();
  }
}

async function dispatch(
  parsed: Extract<Parsed, { ok: true }>,
  ports: LifecyclePorts,
  issuer: string,
): Promise<Record<string, unknown>> {
  const operator = ports.operator;
  const common = { issuer, operator, directory: ports.directory, store: ports.store };
  if (parsed.operation === 'invite' || parsed.operation === 'resolve-invitation') {
    const result = await inviteStaff({
      ...common,
      email: parsed.email as string,
      send: parsed.operation === 'invite' && parsed.send,
    });
    return publicInvite(result);
  }
  if (parsed.operation === 'resend-invitation') {
    const result = await resendInvitation({
      ...common,
      email: parsed.email as string,
      subjectId: parsed.subjectId as string,
      acknowledgeIdentityChange: parsed.acknowledgeIdentityChange,
    });
    return publicInvite(result);
  }
  if (parsed.operation === 'activate') {
    const result = await activateStaff({
      ...common,
      subjectId: parsed.subjectId as string,
      confirmed: parsed.confirm,
      acknowledgeIdentityChange: parsed.acknowledgeIdentityChange,
    });
    return { ...result, provenance: 'unverified-local-process' };
  }
  if (parsed.operation === 'deactivate' || parsed.operation === 'emergency-deactivate') {
    const result = await deactivateStaff({
      ...common,
      subjectId: parsed.subjectId as string,
      emergency: parsed.operation === 'emergency-deactivate',
    });
    return { ...result, provenance: 'unverified-local-process' };
  }
  if (parsed.operation === 'recover-lost-factor' || parsed.operation === 'emergency-recover-lost-factor') {
    const result = await recoverLostFactor({
      ...common,
      subjectId: parsed.subjectId as string,
      emergency: parsed.operation === 'emergency-recover-lost-factor',
      confirmed: parsed.confirm,
    });
    return { ...result, provenance: 'unverified-local-process' };
  }
  if (parsed.operation === 'send-password-setup') {
    const result = await sendPasswordSetup({
      ...common,
      email: parsed.email as string,
      subjectId: parsed.subjectId as string,
      send: parsed.send,
      acknowledgeIdentityChange: parsed.acknowledgeIdentityChange,
    });
    return { ...result, provenance: 'unverified-local-process' };
  }
  if (parsed.operation === 'readmit') {
    const result = await readmitStaff({
      ...common,
      subjectId: parsed.subjectId as string,
      confirmed: parsed.confirm,
      reason: parsed.reason as string,
      acknowledgeIdentityChange: parsed.acknowledgeIdentityChange,
    });
    return { ...result, provenance: 'unverified-local-process' };
  }
  const result = await permitReenrollment({
    ...common,
    subjectId: parsed.subjectId as string,
    confirmed: parsed.confirm,
  });
  return { ...result, provenance: 'unverified-local-process' };
}

function parseArgs(argv: string[], env: Record<string, string | undefined>): Parsed {
  const [operation, ...rest] = argv;
  if (!operation || !operations.includes(operation as LifecycleOperation)) {
    return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'unknown-operation' } };
  }
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? '';
    if (!token.startsWith('--')) return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'invalid-argument' } };
    const name = token.slice(2);
    if (['confirm', 'send', 'connect', 'acknowledge-identity-change'].includes(name)) {
      flags.set(name, true);
      continue;
    }
    if (!['email', 'subject', 'reason', 'expected-database-host', 'expected-staff-project'].includes(name)) {
      return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'unknown-argument' } };
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'missing-value' } };
    }
    if (looksSecret(value, env)) {
      return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'secret-in-argument' } };
    }
    flags.set(name, value);
    index += 1;
  }
  const email = optional(flags, 'email');
  const subjectId = optional(flags, 'subject');
  const reason = optional(flags, 'reason');
  const expectedDatabaseHost = optional(flags, 'expected-database-host');
  const expectedStaffProject = optional(flags, 'expected-staff-project');
  if (!flags.get('confirm') || !expectedDatabaseHost || !expectedStaffProject) {
    return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'missing-confirmation-or-target' } };
  }
  if (subjectId && !/^[0-9a-f-]{36}$/i.test(subjectId)) {
    return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'invalid-subject' } };
  }
  const needsEmail = operation === 'invite' || operation === 'resolve-invitation' || operation === 'resend-invitation' || operation === 'send-password-setup';
  const needsSubject = operation !== 'invite' && operation !== 'resolve-invitation';
  if (needsEmail && !email) return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'missing-email' } };
  if (needsSubject && !subjectId) return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'missing-subject' } };
  if ((operation === 'invite' || operation === 'resend-invitation') && flags.get('send') !== true && operation === 'resend-invitation') {
    return { ok: false, exitCode: 1, body: { outcome: 'refused', reason: 'resend-requires-send' } };
  }
  return {
    ok: true,
    operation: operation as LifecycleOperation,
    email,
    subjectId,
    confirm: true,
    send: flags.get('send') === true,
    connect: flags.get('connect') === true,
    acknowledgeIdentityChange: flags.get('acknowledge-identity-change') === true,
    reason,
    expectedDatabaseHost,
    expectedStaffProject,
  };
}

function optional(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function looksSecret(value: string, env: Record<string, string | undefined>): boolean {
  if (value.includes('://') || value.startsWith('sb_') || value.startsWith('eyJ')) return true;
  const secrets = [env.DATABASE_URL, env.STAFF_SUPABASE_SECRET_KEY, env.SUPABASE_SECRET_KEY];
  return secrets.some((secret) => Boolean(secret) && value.includes(secret as string));
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function projectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const label = host.split('.')[0];
    return label || null;
  } catch {
    return null;
  }
}

/** Builds clients only after prepareLiveConnection has accepted the targets. */
export async function createLivePorts(
  prepared: ReturnType<typeof prepareLiveConnection>,
): Promise<LifecyclePorts> {
  const { PrismaClient } = await import('@prisma/client');
  const { createClient } = await import('@supabase/supabase-js');
  const databaseUrl = process.env.DATABASE_URL;
  const staffUrl = process.env.STAFF_SUPABASE_URL;
  const staffSecret = process.env.STAFF_SUPABASE_SECRET_KEY;
  if (!databaseUrl || !staffUrl || !staffSecret) {
    throw new Error('Staff lifecycle commands refuse to connect without the staff secret in the environment.');
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const admin = createClient(staffUrl, staffSecret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  });
  return {
    issuer: prepared.issuer,
    directory: createStaffDirectory(adaptAdmin(admin.auth.admin), prepared.redirectTo, async (email) => {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: prepared.redirectTo });
      return { error: error ? { status: error.status, message: error.name ?? '', name: error.name } : null };
    }),
    store: createLifecycleStore(prisma),
    operator: { unverifiedProcessUser: process.env.STAFF_LIFECYCLE_OPERATOR?.trim() || 'local-operator' },
    close: () => prisma.$disconnect(),
  };
}

function adaptAdmin(admin: {
  listUsers: StaffAdminApi['listUsers'];
  inviteUserByEmail: StaffAdminApi['inviteUserByEmail'];
  getUserById: StaffAdminApi['getUserById'];
  mfa: StaffAdminApi['mfa'];
}): StaffAdminApi {
  return admin;
}

function publicInvite(result: { outcome: string; subjectId?: string; status?: string; invited?: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    outcome: result.outcome,
    provenance: 'unverified-local-process',
  };
  if (result.subjectId) body.subjectId = result.subjectId;
  if (result.status) body.status = result.status;
  if (typeof result.invited === 'boolean') body.invited = result.invited;
  return body;
}

function publicReason(message: string): string {
  if (message.includes('application database')) return 'database-target';
  if (message.includes('staff-auth project')) return 'staff-project';
  if (message.includes('staff secret')) return 'missing-staff-secret';
  if (message.includes('invitation redirect')) return 'redirect';
  return 'refused';
}

function exitCodeFor(outcome: unknown): number {
  if (outcome === 'uncertain' || outcome === 'unavailable' || outcome === 'unresolved') return 3;
  if (outcome === 'not-sent' || outcome === 'reason-required') return 1;
  if (
    outcome === 'provider-created-membership-missing' ||
    outcome === 'recovery-partial' ||
    outcome === 'identity-changed' ||
    outcome === 'identity-conflict' ||
    outcome === 'cleanup-incomplete' ||
    outcome === 'not-delivered'
  ) {
    return 2;
  }
  if (
    outcome === 'last-operator' ||
    outcome === 'not-recoverable' ||
    outcome === 'not-pending' ||
    outcome === 'not-in-recovery' ||
    outcome === 'not-inactive' ||
    outcome === 'use-recovery' ||
    outcome === 'cleanup-required'
  ) {
    return 5;
  }
  if (outcome === 'refused' || outcome === 'missing' || outcome === 'not-confirmed' || outcome === 'factor-missing' || outcome === 'identity-missing' || outcome === 'identity-unbound') {
    return 1;
  }
  return 0;
}
