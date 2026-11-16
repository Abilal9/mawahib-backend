import { Module } from '@nestjs/common';
import { DeletionEligibilityService } from './deletion-eligibility.service';
import { DeletionRequestController } from './deletion-request.controller';
import { DeletionRequestService } from './deletion-request.service';

@Module({
  controllers: [DeletionRequestController],
  providers: [DeletionEligibilityService, DeletionRequestService],
  exports: [DeletionEligibilityService],
})
export class AccountDeletionModule {}
