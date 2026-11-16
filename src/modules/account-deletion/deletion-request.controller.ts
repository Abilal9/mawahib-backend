import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeletionRequestAllowed } from '../../common/decorators/deletion-request-allowed.decorator';
import type { RequestAuthIdentity } from '../auth/strategies/jwt.strategy';
import { DeletionClosureService } from './deletion-closure.service';
import { DeletionRequestService } from './deletion-request.service';

@Controller('account/deletion')
@DeletionRequestAllowed()
export class DeletionRequestController {
  constructor(
    private readonly requests: DeletionRequestService,
    private readonly closure: DeletionClosureService,
  ) {}

  @Get()
  view(@CurrentUser() user: RequestAuthIdentity) {
    return this.requests.view(user.sub);
  }

  @Post('request')
  request(
    @CurrentUser() user: RequestAuthIdentity & { iat?: number },
    @Body() body: { idempotencyKey?: string },
  ) {
    return this.requests.requestSelf(user.sub, body?.idempotencyKey ?? '', user.iat);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: RequestAuthIdentity) {
    return this.requests.cancelSelf(user.sub);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: RequestAuthIdentity & { iat?: number },
    @Body() body: { idempotencyKey?: string; confirmation?: string },
  ) {
    return this.closure.confirmSelf(
      user.sub,
      body?.idempotencyKey ?? '',
      user.iat,
      body?.confirmation ?? '',
    );
  }
}
