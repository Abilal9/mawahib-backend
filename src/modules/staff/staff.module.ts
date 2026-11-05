import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { StaffGuard } from './staff.guard';
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

@Module({
  imports: [HealthModule],
  controllers: [
    StaffSessionController,
    AdminReadController,
    AccountStatusController,
    OperationsController,
  ],
  providers: [
    StaffMembershipService,
    StaffGuard,
    AdminReadService,
    AccountStatusService,
    OperationsService,
  ],
  exports: [StaffMembershipService],
})
export class StaffModule {}
