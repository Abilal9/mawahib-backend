import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import type { StaffIdentity } from './staff-jwt.strategy';
import { ReportStatusDto } from '../reports/report.dto';
import { ReportQueueService } from './report-queue.service';
import { UnauthorizedException } from '@nestjs/common';

@Controller('admin')
export class ReportQueueController {
  constructor(private readonly reports: ReportQueueService) {}

  @Get('reports/summary')
  @StaffOnly()
  summary() {
    return this.reports.summary();
  }

  @Get('reports')
  @StaffOnly()
  list(@Query() query: Record<string, unknown>) {
    return this.reports.list(query);
  }

  @Get('reports/:id')
  @StaffOnly()
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.detail(id);
  }

  @Post('reports/:id/status')
  @StaffOnly()
  status(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReportStatusDto,
  ) {
    if (!actor?.issuer || !actor.sub) throw new UnauthorizedException();
    return this.reports.changeStatus(id, { issuer: actor.issuer, subjectId: actor.sub }, body);
  }
}
