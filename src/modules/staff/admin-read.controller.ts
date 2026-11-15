import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UnauthorizedException } from '@nestjs/common';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { InvoicesService } from '../invoices/invoices.service';
import { AdminReadService } from './admin-read.service';
import { DisputeCaseActionsService } from './dispute-case-actions.service';
import { requireStaffActor } from './content-moderation.service';
import type { StaffIdentity } from './staff-jwt.strategy';

@Controller('admin')
export class AdminReadController {
  constructor(
    private readonly admin: AdminReadService,
    private readonly invoices: InvoicesService,
    private readonly closures: DisputeCaseActionsService,
  ) {}

  @Get('users')
  @StaffOnly()
  users(@Query() query: Record<string, unknown>) {
    return this.admin.searchUsers(query);
  }

  @Get('users/:id')
  @StaffOnly()
  user(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!actor?.issuer || !actor.sub) {
      throw new UnauthorizedException();
    }
    return this.admin.userDetail(id, { issuer: actor.issuer, subjectId: actor.sub });
  }

  @Get('marketplace/summary')
  @StaffOnly()
  marketplaceSummary() {
    return this.admin.marketplaceSummary();
  }

  @Get('invoices/:id/document')
  @StaffOnly()
  invoiceDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.invoiceDocument(id);
  }

  @Post('invoices/:id/retry')
  @StaffOnly()
  retryInvoice(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoices.retryForStaff(id, requireStaffActor(actor));
  }

  @Get('jobs')
  @StaffOnly()
  jobs(@Query() query: Record<string, unknown>) {
    return this.admin.listJobs(query);
  }

  @Get('jobs/:id')
  @StaffOnly()
  job(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.jobDetail(id);
  }

  @Get('services')
  @StaffOnly()
  services(@Query() query: Record<string, unknown>) {
    return this.admin.listServices(query);
  }

  @Get('services/:id')
  @StaffOnly()
  service(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.serviceDetail(id);
  }

  @Get('applications')
  @StaffOnly()
  applications(@Query() query: Record<string, unknown>) {
    return this.admin.listApplications(query);
  }

  @Get('applications/:id')
  @StaffOnly()
  application(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.applicationDetail(id);
  }

  @Get('engagements')
  @StaffOnly()
  engagements(@Query() query: Record<string, unknown>) {
    return this.admin.listEngagements(query);
  }

  @Get('engagements/:id')
  @StaffOnly()
  engagement(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.engagementDetail(id);
  }

  @Post('engagements/:id/close-work')
  @StaffOnly()
  closeEngagement(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.closures.closeFromEngagement(id, requireStaffActor(actor), body ?? {});
  }

  @Post('engagements/:id/financial-follow-up')
  @StaffOnly()
  recordFinancialFollowUp(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.closures.recordFinancialFollowUp(id, requireStaffActor(actor), body ?? {});
  }
}
