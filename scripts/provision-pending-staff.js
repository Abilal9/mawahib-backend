/**
 * Refuses to write a staff membership.
 *
 * Issuer-aware provisioning is not available yet. The command does not
 * connect to the database. A future replacement may record the OS user
 * who ran it; that name is not a verified staff identity.
 */
'use strict';

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
async function runProvisionPendingStaff(_options = {}) {
  throw new Error(
    'Staff provisioning is disabled until membership records include an issuer. This command does not write.',
  );
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
