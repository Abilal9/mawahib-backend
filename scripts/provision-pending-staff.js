/**
 * Creates a pending staff membership. It does not activate anyone or enroll a factor.
 *
 * Refuses to start unless ALLOW_STAFF_PROVISION is exactly "true".
 * The target Auth subject is STAFF_SUBJECT_ID.
 * This file does not run on startup or install.
 *
 * The process user stored in the audit is whoever ran the command.
 * That name is not a verified staff identity.
 */
'use strict';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unverifiedProcessUser(env = process.env) {
  const name = env.USER || env.USERNAME;
  return typeof name === 'string' && name.trim() ? name.trim() : 'unknown';
}

/**
 * Non-secret identity of the database. Hostname and project reference are
 * not credentials. The userinfo and full URL are never returned.
 */
function describeDatabaseTarget(databaseUrl) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    return { configured: false };
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { configured: true, recognized: false };
  }
  const username = decodeURIComponent(parsed.username || '');
  const host = parsed.hostname;
  let projectRef = null;
  if (username.startsWith('postgres.') && username.length > 'postgres.'.length) {
    projectRef = username.slice('postgres.'.length);
  }
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (!projectRef && direct) projectRef = direct[1];
  return {
    configured: true,
    recognized: true,
    database: parsed.pathname.replace(/^\//, '').split('?')[0] || '',
    host,
    projectRef,
    identity: projectRef || host,
  };
}

function assertExpectedTarget(target, expected) {
  if (!target.recognized || !target.identity) {
    throw new Error(
      'Refusing to provision staff. The database target could not be recognized.',
    );
  }
  const wanted = typeof expected === 'string' ? expected.trim() : '';
  if (!wanted) {
    throw new Error(
      'Refusing to provision staff. Set STAFF_PROVISION_TARGET to the project reference or database host.',
    );
  }
  if (wanted !== target.identity) {
    throw new Error(
      'Refusing to provision staff. STAFF_PROVISION_TARGET does not match this database. Nothing was written.',
    );
  }
}

/**
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {{ provisionPending: (subjectId: string, actor: { unverifiedProcessUser: string }) => Promise<{ created: boolean }> }} [options.staff]
 */
async function runProvisionPendingStaff(options = {}) {
  const env = options.env ?? process.env;
  if (env.ALLOW_STAFF_PROVISION !== 'true') {
    throw new Error(
      'Refusing to provision staff. Set ALLOW_STAFF_PROVISION=true for this command only.',
    );
  }
  const subjectId =
    typeof env.STAFF_SUBJECT_ID === 'string' ? env.STAFF_SUBJECT_ID.trim() : '';
  if (!UUID.test(subjectId)) {
    throw new Error('STAFF_SUBJECT_ID must be the Auth subject UUID.');
  }

  const target = describeDatabaseTarget(env.DATABASE_URL);
  assertExpectedTarget(target, env.STAFF_PROVISION_TARGET);
  const actor = { unverifiedProcessUser: unverifiedProcessUser(env) };
  if (options.staff) {
    const result = await options.staff.provisionPending(subjectId, actor);
    return { target, result };
  }

  require('ts-node/register/transpile-only');
  const { PrismaClient } = require('@prisma/client');
  const {
    StaffMembershipService,
  } = require('../src/modules/staff/staff-membership.service');
  const prisma = new PrismaClient();
  try {
    const result = await new StaffMembershipService(prisma).provisionPending(
      subjectId,
      actor,
    );
    return { target, result };
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  assertExpectedTarget,
  describeDatabaseTarget,
  runProvisionPendingStaff,
  unverifiedProcessUser,
};

if (require.main === module) {
  runProvisionPendingStaff()
    .then((outcome) => {
      process.stdout.write(
        `${JSON.stringify({
          created: outcome.result.created,
          database: outcome.target,
        })}\n`,
      );
    })
    .catch((err) => {
      const message =
        err instanceof Error ? err.message : 'Staff provisioning failed';
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
