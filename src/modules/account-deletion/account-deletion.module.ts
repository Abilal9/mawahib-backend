import { Module } from '@nestjs/common';
import { DeletionEligibilityService } from './deletion-eligibility.service';

@Module({
  providers: [DeletionEligibilityService],
  exports: [DeletionEligibilityService],
})
export class AccountDeletionModule {}
