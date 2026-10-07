import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import {
  EngagementInvoicesController,
  InvoicesController,
} from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { INVOICING_PROVIDER } from './invoicing-provider.interface';
import { MockInvoicingProvider } from './mock-invoicing.provider';
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
      // INVOICE_PROVIDER currently only allows `mock`; add a real provider and
      // select it here from ConfigService when one exists.
      provide: INVOICING_PROVIDER,
      useClass: MockInvoicingProvider,
    },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
