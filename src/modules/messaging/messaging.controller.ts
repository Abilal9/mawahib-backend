import {
  Body,
  Controller,
  Delete,
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
  ConversationMediaPageDto,
  ConversationResponseDto,
  ConversationUnreadSummaryDto,
  MessageResponseDto,
  MessagesPageDto,
} from './dto/messaging-response.dto';
import {
  ListConversationMediaQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/messaging.dto';
import { MessagingService } from './messaging.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('users/me/conversations')
  listMine(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationResponseDto[]> {
    return this.messaging.listMyConversations(user.sub, query);
  }

  @Get('users/me/conversations/unread-summary')
  unreadSummary(
    @CurrentUser() user: JwtPayload,
  ): Promise<ConversationUnreadSummaryDto> {
    return this.messaging.getUnreadSummary(user.sub);
  }

  @Get('conversations/:id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationResponseDto> {
    return this.messaging.getConversation(user.sub, id);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<MessagesPageDto> {
    return this.messaging.listMessages(user.sub, id, query);
  }

  @Get('conversations/:id/media')
  listMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListConversationMediaQueryDto,
  ): Promise<ConversationMediaPageDto> {
    return this.messaging.listConversationMedia(user.sub, id, query);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messaging.sendMessage(user.sub, id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationResponseDto> {
    return this.messaging.markRead(user.sub, id);
  }

  @Post('conversations/:id/archive')
  @HttpCode(200)
  archive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationResponseDto> {
    return this.messaging.archiveConversationForMe(user.sub, id);
  }

  @Post('conversations/:id/unarchive')
  @HttpCode(200)
  unarchive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationResponseDto> {
    return this.messaging.unarchiveConversationForMe(user.sub, id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async softDelete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.messaging.deleteConversationForMe(user.sub, id);
  }
}
