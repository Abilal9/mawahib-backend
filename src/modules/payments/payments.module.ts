import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import {
  EngagementPaymentsController,
  PaymentsController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_REPOSITORY } from './repositories/payment.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payment.repository';

@Module({
  imports: [MarketplaceModule, InvoicesModule],
  controllers: [PaymentsController, EngagementPaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_REPOSITORY,
      useClass: PrismaPaymentRepository,
    },
    {
      // PAYMENT_PROVIDER currently only allows `mock` (and validateEnv refuses
      // it in production). Select a real PSP here from ConfigService later.
      provide: PAYMENT_PROVIDER,
      useClass: MockPaymentProvider,
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
