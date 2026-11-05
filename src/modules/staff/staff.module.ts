import { Module } from '@nestjs/common';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { StaffGuard } from './staff.guard';
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

@Module({
  controllers: [StaffSessionController, AdminReadController, AccountStatusController],
  providers: [StaffMembershipService, StaffGuard, AdminReadService, AccountStatusService],
  exports: [StaffMembershipService],
})
export class StaffModule {}
