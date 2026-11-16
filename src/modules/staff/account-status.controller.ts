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
import { DeletionCleanupRunner } from '../account-deletion/deletion-cleanup.runner';
import { DeletionClosureService } from '../account-deletion/deletion-closure.service';

@Controller('admin')
export class AccountStatusController {
  constructor(
    private readonly accounts: AccountStatusService,
    private readonly closure: DeletionClosureService,
    private readonly cleanup: DeletionCleanupRunner,
  ) {}

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

  @Get('users/:id/deletion')
  @StaffOnly()
  deletionStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.cleanup.statusFor(id);
  }

  @Post('users/:id/deletion/confirm')
  @StaffOnly()
  confirmDeletion(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string; confirmedEmail?: string; idempotencyKey?: string },
  ) {
    if (!actor?.sub || !actor.issuer) {
      throw new UnauthorizedException();
    }
    return this.closure.confirmStaff(
      { issuer: actor.issuer, subjectId: actor.sub },
      id,
      {
        reason: body?.reason ?? '',
        confirmedEmail: body?.confirmedEmail ?? '',
        idempotencyKey: body?.idempotencyKey ?? '',
      },
    );
  }

  @Post('users/:id/deletion/cleanup/:taskId/retry')
  @StaffOnly()
  retryDeletionCleanup(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.cleanup.retry(id, taskId);
  }
}
