import { Controller, Get, Param, ParseUUIDPipe, Post, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import type { RequestAuthIdentity } from '../auth/strategies/jwt.strategy';
import { AccountStatusService } from './account-status.service';

@Controller('admin')
export class AccountStatusController {
  constructor(private readonly accounts: AccountStatusService) {}

  @Post('users/:id/account-status')
  @StaffOnly()
  change(
    @CurrentUser() actor: RequestAuthIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.accounts.change(actor.sub, id, body ?? {});
  }

  @Get('account-actions')
  @StaffOnly()
  list(@Query() query: Record<string, unknown>) {
    return this.accounts.list(query);
  }

  @Get('account-actions/:id')
  @StaffOnly()
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.detail(id);
  }
}
