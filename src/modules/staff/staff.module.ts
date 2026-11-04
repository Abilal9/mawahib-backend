import { Module } from '@nestjs/common';
import { StaffGuard } from './staff.guard';
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

@Module({
  controllers: [StaffSessionController],
  providers: [StaffMembershipService, StaffGuard],
  exports: [StaffMembershipService],
})
export class StaffModule {}
