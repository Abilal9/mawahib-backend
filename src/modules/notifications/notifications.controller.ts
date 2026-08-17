import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  MarkAllReadResponseDto,
  NotificationResponseDto,
  NotificationUnreadSummaryDto,
} from './dto/notification-response.dto';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('users/me/notifications')
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationResponseDto[]> {
    return this.notifications.listForUser(user.sub, query);
  }

  @Get('users/me/notifications/unread-summary')
  unreadSummary(
    @CurrentUser() user: JwtPayload,
  ): Promise<NotificationUnreadSummaryDto> {
    return this.notifications.unreadCount(user.sub);
  }

  @Post('users/me/notifications/:id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(user.sub, id);
  }

  @Post('users/me/notifications/read-all')
  @HttpCode(200)
  markAllRead(
    @CurrentUser() user: JwtPayload,
  ): Promise<MarkAllReadResponseDto> {
    return this.notifications.markAllRead(user.sub);
  }
}
