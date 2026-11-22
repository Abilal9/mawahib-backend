import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RegistrationCredential } from '../../common/decorators/registration-credential.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { DetachPushDeviceDto, RegisterPushDeviceDto, SetPushViewingDto } from './dto/push.dto';
import { PushService } from './push.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly prisma: PrismaService,
  ) {}

  @Put('users/me/push-devices')
  register(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterPushDeviceDto,
  ) {
    return this.push.register({
      userId: user.sub,
      installationId: dto.installationId,
      expoPushToken: dto.expoPushToken,
      platform: dto.platform,
    });
  }

  @Post('push-device-detach')
  @RegistrationCredential()
  @HttpCode(204)
  async detach(@Body() dto: DetachPushDeviceDto): Promise<void> {
    await this.push.detach({
      installationId: dto.installationId,
      registrationGeneration: dto.registrationGeneration,
      detachSecret: dto.detachSecret,
    });
  }

  @Delete('users/me/push-devices/:installationId')
  @HttpCode(204)
  async unregister(
    @CurrentUser() user: JwtPayload,
    @Param('installationId', ParseUUIDPipe) installationId: string,
  ): Promise<void> {
    await this.push.unregister(user.sub, installationId);
  }

  @Put('users/me/push-devices/:installationId/viewing')
  @HttpCode(204)
  async view(
    @CurrentUser() user: JwtPayload,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Body() dto: SetPushViewingDto,
  ): Promise<void> {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId: dto.conversationId,
        userId: user.sub,
        deletedAt: null,
      },
      select: { id: true },
    });
    await this.push.setViewing({
      userId: user.sub,
      installationId,
      conversationId: dto.conversationId,
      now: new Date(),
      allowed: participant != null,
    });
  }

  @Delete('users/me/push-devices/:installationId/viewing')
  @HttpCode(204)
  async clearViewing(
    @CurrentUser() user: JwtPayload,
    @Param('installationId', ParseUUIDPipe) installationId: string,
  ): Promise<void> {
    await this.push.clearViewing(user.sub, installationId);
  }
}
