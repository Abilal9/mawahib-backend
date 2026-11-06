import { Controller, Get, Param, ParseUUIDPipe, Query, UnauthorizedException } from '@nestjs/common';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { AdminReadService } from './admin-read.service';
import type { StaffIdentity } from './staff-jwt.strategy';

@Controller('admin')
export class AdminReadController {
  constructor(private readonly admin: AdminReadService) {}

  @Get('users')
  @StaffOnly()
  users(@Query() query: Record<string, unknown>) {
    return this.admin.searchUsers(query);
  }

  @Get('users/:id')
  @StaffOnly()
  user(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!actor?.issuer || !actor.sub) {
      throw new UnauthorizedException();
    }
    return this.admin.userDetail(id, { issuer: actor.issuer, subjectId: actor.sub });
  }

  @Get('disputes')
  @StaffOnly()
  disputes(@Query() query: Record<string, unknown>) {
    return this.admin.listDisputes(query);
  }

  @Get('disputes/:id')
  @StaffOnly()
  dispute(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.disputeDetail(id);
  }
}
