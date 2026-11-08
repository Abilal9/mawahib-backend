/**
 * Inserts inbox rows for one recipient so pagination can be checked.
 * Does not create likes, comments, messages, or moderation actions.
 *
 * Refuses to run unless ENABLE_NOTIFICATION_FIXTURE=true.
 *
 *   ENABLE_NOTIFICATION_FIXTURE=true node scripts/seed-notification-history.mjs <user-uuid> [count]
 *
 * The rows say "Development fixture" and point at a post that does not exist,
 * so opening one shows the unavailable post state. Remove them from the inbox
 * with the app's Clear all, or delete the rows for that recipient whose body
 * is exactly "Development fixture".
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const recipientId = process.argv[2];
const count = Number(process.argv[3] ?? 25);

if (process.env.ENABLE_NOTIFICATION_FIXTURE !== 'true') {
  console.error('Refusing to insert fixture notifications. Set ENABLE_NOTIFICATION_FIXTURE=true to run this once.');
  process.exit(1);
}
if (!recipientId || !/^[0-9a-f-]{36}$/i.test(recipientId)) {
  console.error('Pass the recipient user id.');
  process.exit(1);
}
if (!Number.isInteger(count) || count < 1 || count > 40) {
  console.error('Count must be from 1 to 40.');
  process.exit(1);
}

const missingPostId = '00000000-0000-4000-8000-000000000099';
const prisma = new PrismaClient();
const now = Date.now();
await prisma.notification.createMany({
  data: Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    recipientId,
    type: 'system',
    title: 'Mawahib',
    body: 'Development fixture',
    payload: {
      screen: 'post',
      params: { postId: missingPostId },
    },
    createdAt: new Date(now - index * 1000),
  })),
});
console.log(`Inserted ${count} fixture notifications for ${recipientId}.`);
await prisma.$disconnect();
