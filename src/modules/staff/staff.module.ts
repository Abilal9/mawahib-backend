import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { MediaModule } from '../media/media.module';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { DisputeCaseActionsService } from './dispute-case-actions.service';
import { DisputeCaseController } from './dispute-case.controller';
import { DisputeCaseService } from './dispute-case.service';
import { ContentModerationController } from './content-moderation.controller';
import { ContentModerationService } from './content-moderation.service';
import { ReportQueueController } from './report-queue.controller';
import { ReportQueueService } from './report-queue.service';
import { StaffJwtGuard } from './staff-jwt.guard';
import { StaffJwtStrategy } from './staff-jwt.strategy';
import { StaffGuard } from './staff.guard';
import { StaffMembershipService } from './staff-membership.service';
import { StaffSessionController } from './staff-session.controller';

@Module({
  imports: [HealthModule, MediaModule],
  controllers: [
    StaffSessionController,
    AdminReadController,
    AccountStatusController,
    OperationsController,
    ReportQueueController,
    ContentModerationController,
    DisputeCaseController,
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
    ContentModerationService,
    DisputeCaseService,
    DisputeCaseActionsService,
  ],
  exports: [StaffMembershipService],
})
export class StaffModule {}
