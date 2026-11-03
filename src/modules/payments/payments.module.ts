import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { InvoicesModule } from '../invoices/invoices.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { createPaymentProvider } from './create-payment-provider';
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
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) =>
        createPaymentProvider(
          config.get('PAYMENT_PROVIDER', { infer: true }),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
