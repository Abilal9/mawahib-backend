import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { ReportQueueController } from './report-queue.controller';
import { ReportQueueService } from './report-queue.service';
import { StaffJwtGuard } from './staff-jwt.guard';
import { StaffJwtStrategy } from './staff-jwt.strategy';
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
    ReportQueueController,
  ],
  providers: [
    StaffMembershipService,
    StaffJwtStrategy,
    StaffJwtGuard,
    StaffGuard,
    AdminReadService,
    AccountStatusService,
    OperationsService,
    ReportQueueService,
  ],
  exports: [StaffMembershipService],
})
export class StaffModule {}
