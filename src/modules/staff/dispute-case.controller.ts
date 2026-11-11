import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UnauthorizedException } from '@nestjs/common';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { DisputeCaseActionsService } from './dispute-case-actions.service';
import { DisputeCaseService } from './dispute-case.service';
import type { StaffIdentity } from './staff-jwt.strategy';

@Controller('admin')
export class DisputeCaseController {
  constructor(
    private readonly cases: DisputeCaseService,
    private readonly actions: DisputeCaseActionsService,
  ) {}

  @Get('dispute-cases/summary')
  @StaffOnly()
  summary() {
    return this.cases.summary();
  }

  @Get('dispute-cases')
  @StaffOnly()
  list(@CurrentStaff() actor: StaffIdentity | undefined, @Query() query: Record<string, unknown>) {
    return this.cases.list(requireActor(actor), query);
  }

  @Get('dispute-cases/:id/assignees')
  @StaffOnly()
  assignees(@CurrentStaff() actor: StaffIdentity | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.assignees(id, requireActor(actor));
  }

  @Get('dispute-cases/:id')
  @StaffOnly()
  detail(@CurrentStaff() actor: StaffIdentity | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.detail(id, requireActor(actor));
  }

  @Post('dispute-cases/:id/status')
  @StaffOnly()
  status(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.actions.changeStatus(id, requireActor(actor), body ?? {});
  }

  @Post('dispute-cases/:id/assignment')
  @StaffOnly()
  assignment(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.actions.changeAssignment(id, requireActor(actor), body ?? {});
  }

  @Post('dispute-cases/:id/notes')
  @StaffOnly()
  note(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.actions.addNote(id, requireActor(actor), body ?? {});
  }

  @Post('dispute-cases/:id/resolution')
  @StaffOnly()
  resolution(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.actions.resolve(id, requireActor(actor), body ?? {});
  }
}

function requireActor(actor: StaffIdentity | undefined) {
  if (!actor?.issuer || !actor.sub) throw new UnauthorizedException();
  return { issuer: actor.issuer, subjectId: actor.sub };
}
