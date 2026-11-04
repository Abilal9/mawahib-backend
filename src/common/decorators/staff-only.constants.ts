import { StaffRole } from '@prisma/client';

/** Missing product profile may pass JwtAuthGuard. StaffGuard still runs. */
export const STAFF_ONLY_KEY = 'staffOnly';

/** Role this staff route requires. The guard reads it from the handler. */
export const STAFF_ROLE_KEY = 'staffRole';

export const DEFAULT_STAFF_ROLE = StaffRole.operator;
