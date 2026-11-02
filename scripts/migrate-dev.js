/**
 * Opt-in wrapper for `prisma migrate dev`.
 *
 * Refuses to start Prisma unless ALLOW_MIGRATE_DEV is exactly "true".
 * This guards the project script only. It does not prove a database is
 * disposable, and it does not stop someone from invoking Prisma directly.
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const REFUSAL_MESSAGE =
  'Refusing to run prisma migrate dev. This is a development-only command. ' +
  'It does not check that the database is disposable. Verify the database ' +
  'target, then rerun with ALLOW_MIGRATE_DEV=true.';

function prismaDevInvocation(userArgs = []) {
  return {
    command: process.execPath,
    args: [
      path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'dev',
      ...userArgs,
    ],
  };
}

function errorText(err) {
  if (err instanceof Error && err.message) return err.message;
  return 'unknown launch error';
}

/**
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string[]} [options.args]
 * @param {string} [options.command]
 * @param {string[]} [options.commandArgs]
 * @param {'inherit' | 'pipe' | 'ignore'} [options.stdio]
 * @param {(command: string, args: string[], options: object) => import('node:events').EventEmitter} [options.spawnImpl]
 * @param {(text: string) => void} [options.writeError]
 * @returns {Promise<number>}
 */
function runMigrateDev(options = {}) {
  const env = options.env ?? process.env;
  const userArgs = options.args ?? [];
  const writeError =
    options.writeError ?? ((text) => process.stderr.write(text));
  const spawnImpl = options.spawnImpl ?? spawn;

  if (env.ALLOW_MIGRATE_DEV !== 'true') {
    writeError(`${REFUSAL_MESSAGE}\n`);
    return Promise.resolve(1);
  }

  const invocation = options.command
    ? {
        command: options.command,
        args: [...(options.commandArgs ?? []), ...userArgs],
      }
    : prismaDevInvocation(userArgs);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };

    let child;
    try {
      child = spawnImpl(invocation.command, invocation.args, {
        stdio: options.stdio ?? 'inherit',
        env,
        shell: false,
      });
    } catch (err) {
      writeError(`Failed to start Prisma: ${errorText(err)}\n`);
      finish(1);
      return;
    }

    if (!child || typeof child.on !== 'function') {
      writeError('Failed to start Prisma: invalid process handle\n');
      finish(1);
      return;
    }

    child.on('error', (err) => {
      writeError(`Failed to start Prisma: ${errorText(err)}\n`);
      finish(1);
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        finish(1);
        return;
      }
      finish(typeof code === 'number' ? code : 1);
    });
  });
}

if (require.main === module) {
  runMigrateDev({ args: process.argv.slice(2) })
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      process.stderr.write(`Failed to start Prisma: ${errorText(err)}\n`);
      process.exit(1);
    });
}

module.exports = {
  REFUSAL_MESSAGE,
  prismaDevInvocation,
  runMigrateDev,
};
