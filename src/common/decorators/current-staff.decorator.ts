import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { StaffIdentity } from '../../modules/staff/staff-jwt.strategy';

/** Verified staff realm identity. This is not a product user. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffIdentity | undefined => {
    const request = ctx.switchToHttp().getRequest<{ staff?: StaffIdentity }>();
    return request.staff;
  },
);
