/**
 * Disabled. Targeted notification-fixture creation and cleanup are not implemented.
 * This command does not connect to a database and does not write notifications.
 * Do not use Clear all to clean up fixtures. Clear all changes every notification
 * for the account, including real history and read state.
 */
console.error(
  'Notification fixtures are disabled. Targeted fixture creation and cleanup are not implemented. This command does not connect to a database and does not write notifications.',
);
process.exit(1);
