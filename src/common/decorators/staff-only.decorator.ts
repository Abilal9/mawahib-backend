import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { StaffGuard } from '../../modules/staff/staff.guard';
import { StaffJwtGuard } from '../../modules/staff/staff-jwt.guard';
import {
  DEFAULT_STAFF_ROLE,
  STAFF_ONLY_KEY,
  STAFF_ROLE_KEY,
} from './staff-only.constants';

/**
 * Product JWT stays required on ordinary routes.
 * Staff routes skip that strategy and verify only the staff realm.
 */
export const StaffOnly = (role: StaffRole = DEFAULT_STAFF_ROLE) =>
  applyDecorators(
    SetMetadata(STAFF_ONLY_KEY, true),
    SetMetadata(STAFF_ROLE_KEY, role),
    UseGuards(StaffJwtGuard, StaffGuard),
  );

export { STAFF_ONLY_KEY, STAFF_ROLE_KEY };
