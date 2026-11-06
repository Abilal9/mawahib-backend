import { StaffRole } from '@prisma/client';

/** Staff routes skip the product JWT strategy. StaffJwtGuard verifies the staff realm. */
export const STAFF_ONLY_KEY = 'staffOnly';

/** Role this staff route requires. The guard reads it from the handler. */
export const STAFF_ROLE_KEY = 'staffRole';

export const DEFAULT_STAFF_ROLE = StaffRole.operator;
