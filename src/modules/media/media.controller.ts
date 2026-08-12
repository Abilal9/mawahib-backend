import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CreateUploadSessionDto } from './dto/media.dto';
import {
  MediaAssetResponseDto,
  UploadSessionResponseDto,
} from './dto/media-response.dto';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-sessions')
  createUploadSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateUploadSessionDto,
  ): Promise<UploadSessionResponseDto> {
    return this.mediaService.createUploadSession(user.sub, dto);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<MediaAssetResponseDto> {
    return this.mediaService.completeUpload(user.sub, id);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<MediaAssetResponseDto> {
    return this.mediaService.getOwnedAsset(user.sub, id);
  }
}
