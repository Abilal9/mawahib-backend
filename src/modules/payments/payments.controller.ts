import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CreatePaymentDto } from './dto/payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Pay an engagement. Responds with the payment — check `status`:
   * `succeeded` starts the work, `failed` leaves the job pending_payment.
   */
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.createPayment(user.sub, dto);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.getPayment(user.sub, id);
  }
}

@Controller('engagements')
@UseGuards(JwtAuthGuard)
export class EngagementPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Succeeded payment, else the latest attempt; 404 when none exists. */
  @Get(':engagementId/payment')
  getForEngagement(
    @CurrentUser() user: JwtPayload,
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.getPaymentForEngagement(user.sub, engagementId);
  }
}
