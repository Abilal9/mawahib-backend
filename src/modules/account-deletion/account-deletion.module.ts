import { Module } from '@nestjs/common';
import { DeletionCleanupRunner } from './deletion-cleanup.runner';
import { DeletionClosureService } from './deletion-closure.service';
import { DeletionEligibilityService } from './deletion-eligibility.service';
import { DeletionRequestController } from './deletion-request.controller';
import { DeletionRequestService } from './deletion-request.service';

@Module({
  controllers: [DeletionRequestController],
  providers: [
    DeletionEligibilityService,
    DeletionRequestService,
    DeletionClosureService,
    DeletionCleanupRunner,
  ],
  exports: [DeletionEligibilityService, DeletionClosureService, DeletionCleanupRunner],
})
export class AccountDeletionModule {}
