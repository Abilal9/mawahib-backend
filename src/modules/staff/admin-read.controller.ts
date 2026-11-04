import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { AdminReadService } from './admin-read.service';

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
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.userDetail(id);
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
