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
import { ConnectionsService } from './connections.service';
import {
  ConnectionRequestResponseDto,
  ConnectionResponseDto,
} from './dto/connection-response.dto';
import {
  CreateConnectionRequestDto,
  ListConnectionRequestsQueryDto,
} from './dto/connection.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post('connection-requests')
  createRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateConnectionRequestDto,
  ): Promise<ConnectionRequestResponseDto> {
    return this.connections.createRequest(user.sub, dto);
  }

  @Get('users/me/connection-requests')
  listRequests(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListConnectionRequestsQueryDto,
  ): Promise<ConnectionRequestResponseDto[]> {
    return this.connections.listRequests(user.sub, query);
  }

  @Post('connection-requests/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectionResponseDto> {
    return this.connections.acceptRequest(user.sub, id);
  }

  @Post('connection-requests/:id/reject')
  @HttpCode(204)
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.connections.rejectRequest(user.sub, id);
  }

  @Post('connection-requests/:id/cancel')
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.connections.cancelRequest(user.sub, id);
  }

  @Get('users/me/connections')
  listConnections(
    @CurrentUser() user: JwtPayload,
  ): Promise<ConnectionResponseDto[]> {
    return this.connections.listConnections(user.sub);
  }

  @Post('users/me/connections/:peerUserId/conversation')
  @HttpCode(200)
  openConversation(
    @CurrentUser() user: JwtPayload,
    @Param('peerUserId', ParseUUIDPipe) peerUserId: string,
  ): Promise<{ conversationId: string }> {
    return this.connections.openConnectionConversation(user.sub, peerUserId);
  }

  @Delete('users/me/connections/:userId')
  @HttpCode(204)
  async endConnection(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) peerUserId: string,
  ): Promise<void> {
    await this.connections.endConnection(user.sub, peerUserId);
  }
}
