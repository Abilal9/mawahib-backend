import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { ContentModerationService, requireStaffActor } from './content-moderation.service';
import type { StaffIdentity } from './staff-jwt.strategy';

@Controller('admin')
export class ContentModerationController {
  constructor(private readonly moderation: ContentModerationService) {}

  @Post('posts/:id/moderation')
  @StaffOnly()
  changePost(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.moderation.changePost(requireStaffActor(actor), id, body ?? {});
  }

  @Post('post-comments/:id/moderation')
  @StaffOnly()
  changeComment(
    @CurrentStaff() actor: StaffIdentity | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.moderation.changeComment(requireStaffActor(actor), id, body ?? {});
  }

  @Get('content-actions')
  @StaffOnly()
  list(@Query() query: Record<string, unknown>) {
    return this.moderation.list(query);
  }
}
