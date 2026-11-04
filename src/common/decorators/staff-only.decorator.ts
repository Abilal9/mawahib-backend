import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { StaffGuard } from '../../modules/staff/staff.guard';
import {
  DEFAULT_STAFF_ROLE,
  STAFF_ONLY_KEY,
  STAFF_ROLE_KEY,
} from './staff-only.constants';

/**
 * JWT stays required. The route is not public and is not bootstrap.
 * StaffGuard is attached here so the missing-profile exception cannot be used alone.
 */
export const StaffOnly = (role: StaffRole = DEFAULT_STAFF_ROLE) =>
  applyDecorators(
    SetMetadata(STAFF_ONLY_KEY, true),
    SetMetadata(STAFF_ROLE_KEY, role),
    UseGuards(StaffGuard),
  );

export { STAFF_ONLY_KEY, STAFF_ROLE_KEY };
