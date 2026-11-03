import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { MediaModule } from '../media/media.module';
import {
  EngagementInvoicesController,
  InvoicesController,
} from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { createInvoicingProvider } from './create-invoicing-provider';
import { INVOICING_PROVIDER } from './invoicing-provider.interface';
import { INVOICE_REPOSITORY } from './repositories/invoice.repository';
import { PrismaInvoiceRepository } from './repositories/prisma-invoice.repository';

@Module({
  imports: [MediaModule],
  controllers: [InvoicesController, EngagementInvoicesController],
  providers: [
    InvoicesService,
    {
      provide: INVOICE_REPOSITORY,
      useClass: PrismaInvoiceRepository,
    },
    {
      provide: INVOICING_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) =>
        createInvoicingProvider(
          config.get('INVOICE_PROVIDER', { infer: true }),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
