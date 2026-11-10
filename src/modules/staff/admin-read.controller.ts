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

  @Get('marketplace/summary')
  @StaffOnly()
  marketplaceSummary() {
    return this.admin.marketplaceSummary();
  }

  @Get('jobs')
  @StaffOnly()
  jobs(@Query() query: Record<string, unknown>) {
    return this.admin.listJobs(query);
  }

  @Get('jobs/:id')
  @StaffOnly()
  job(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.jobDetail(id);
  }

  @Get('services')
  @StaffOnly()
  services(@Query() query: Record<string, unknown>) {
    return this.admin.listServices(query);
  }

  @Get('services/:id')
  @StaffOnly()
  service(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.serviceDetail(id);
  }

  @Get('applications')
  @StaffOnly()
  applications(@Query() query: Record<string, unknown>) {
    return this.admin.listApplications(query);
  }

  @Get('applications/:id')
  @StaffOnly()
  application(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.applicationDetail(id);
  }

  @Get('engagements')
  @StaffOnly()
  engagements(@Query() query: Record<string, unknown>) {
    return this.admin.listEngagements(query);
  }

  @Get('engagements/:id')
  @StaffOnly()
  engagement(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.engagementDetail(id);
  }
}
