import { Module } from '@nestjs/common';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { StaffGuard } from './staff.guard';
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

@Module({
  controllers: [StaffSessionController, AdminReadController],
  providers: [StaffMembershipService, StaffGuard, AdminReadService],
  exports: [StaffMembershipService],
})
export class StaffModule {}
