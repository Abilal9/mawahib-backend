import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';
import { EXPLORE_REPOSITORY } from './repositories/explore.repository';
import { PrismaExploreRepository } from './repositories/prisma-explore.repository';

@Module({
  imports: [MediaModule],
  controllers: [ExploreController],
  providers: [
    ExploreService,
    {
      provide: EXPLORE_REPOSITORY,
      useClass: PrismaExploreRepository,
    },
  ],
  exports: [ExploreService],
})
export class ExploreModule {}
