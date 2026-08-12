import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MEDIA_ASSET_REPOSITORY } from './repositories/media-asset.repository';
import { PrismaMediaAssetRepository } from './repositories/prisma-media-asset.repository';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: MEDIA_ASSET_REPOSITORY,
      useClass: PrismaMediaAssetRepository,
    },
  ],
  exports: [MediaService, MEDIA_ASSET_REPOSITORY],
})
export class MediaModule {}
