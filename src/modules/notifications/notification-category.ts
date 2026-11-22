import { NotificationType } from '@prisma/client';

/** Omitted `category` means the whole inbox. `all` is not a value. */
export const NOTIFICATION_CATEGORIES = [
  'jobs',
  'messages',
  'connections',
  'posts',
  'platform_updates',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const JOBS: readonly NotificationType[] = [
  NotificationType.engagement_status,
  NotificationType.work_request_event,
];
const MESSAGES: readonly NotificationType[] = [NotificationType.message_received];
const CONNECTIONS: readonly NotificationType[] = [
  NotificationType.connection_request,
  NotificationType.connection_accepted,
];
const POSTS: readonly NotificationType[] = [
  NotificationType.post_liked,
  NotificationType.post_commented,
];

const ASSIGNED = new Set<NotificationType>([
  ...JOBS,
  ...MESSAGES,
  ...CONNECTIONS,
  ...POSTS,
]);

/** Platform Updates is every stored type that is not one of the other four categories. */
export function notificationTypesForCategory(
  category: NotificationCategory,
): NotificationType[] {
  switch (category) {
    case 'jobs':
      return [...JOBS];
    case 'messages':
      return [...MESSAGES];
    case 'connections':
      return [...CONNECTIONS];
    case 'posts':
      return [...POSTS];
    case 'platform_updates':
      return Object.values(NotificationType).filter((type) => !ASSIGNED.has(type));
  }
}

export function categoryForNotificationType(type: NotificationType): NotificationCategory {
  if ((JOBS as readonly NotificationType[]).includes(type)) return 'jobs';
  if ((MESSAGES as readonly NotificationType[]).includes(type)) return 'messages';
  if ((CONNECTIONS as readonly NotificationType[]).includes(type)) return 'connections';
  if ((POSTS as readonly NotificationType[]).includes(type)) return 'posts';
  return 'platform_updates';
}
