import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';

@Module({
  imports: [MediaModule],
  controllers: [ExploreController],
  providers: [ExploreService],
  exports: [ExploreService],
})
export class ExploreModule {}
