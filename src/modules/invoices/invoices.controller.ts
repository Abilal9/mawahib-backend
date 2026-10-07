import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  InvoiceDocumentResponseDto,
  InvoiceResponseDto,
} from './dto/invoice-response.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoices.getInvoice(user.sub, id);
  }

  /** Short-lived signed URL for the invoice PDF. */
  @Get(':id/document')
  document(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceDocumentResponseDto> {
    return this.invoices.getDocument(user.sub, id);
  }
}

@Controller('engagements')
@UseGuards(JwtAuthGuard)
export class EngagementInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':engagementId/invoices')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
  ): Promise<InvoiceResponseDto[]> {
    return this.invoices.listForEngagement(user.sub, engagementId);
  }
}
