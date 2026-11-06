import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import type { StaffIdentity } from './staff-jwt.strategy';
import { AccountStatusService } from './account-status.service';

@Controller('admin')
export class AccountStatusController {
  constructor(private readonly accounts: AccountStatusService) {}

  @Post('users/:id/account-status')
  @StaffOnly()
  change(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!actor?.sub || !actor.issuer) {
      throw new UnauthorizedException();
    }
    return this.accounts.change(
      { issuer: actor.issuer, subjectId: actor.sub },
      id,
      body ?? {},
    );
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
