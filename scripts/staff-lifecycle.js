/**
 * Operator entry for staff invitation and lifecycle commands.
 * Validation finishes before a client is constructed.
 * Secrets stay in the environment. They are not accepted as arguments and are not printed.
 * --connect is required before any driver runs. This file does not connect unless that flag is present.
 *
 * Exit codes: 0 success or no-op, 1 refusal, 2 partial or identity mismatch, 3 uncertain or unavailable, 4 target mismatch, 5 business rule.
 *
 * Later hosting must set both email templates to server-checked token links:
 * invite: {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite
 * recovery: {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
 * RedirectTo is exactly https://admin.mawahib.io or http://127.0.0.1:5174.
 * A hash-carried session is not a verified invitation or recovery.
 */
require('ts-node/register/transpile-only');

const { createLivePorts, executeStaffLifecycle } = require('../src/modules/staff/staff-lifecycle.command.ts');

if (require.main === module) {
  executeStaffLifecycle(process.argv.slice(2), process.env, {
    factory: createLivePorts,
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result.body)}\n`);
      process.exit(result.exitCode);
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify({ outcome: 'refused', reason: 'command-failed' })}\n`);
      process.exit(1);
    });
}

module.exports = { executeStaffLifecycle };
