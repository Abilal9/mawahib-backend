import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import {
  ApplicationsController,
  EngagementsController,
  JobListingsController,
  MyMarketplaceController,
} from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MARKETPLACE_REPOSITORY } from './repositories/marketplace.repository';
import { PrismaMarketplaceRepository } from './repositories/prisma-marketplace.repository';

@Module({
  imports: [UsersModule],
  controllers: [
    JobListingsController,
    ApplicationsController,
    EngagementsController,
    MyMarketplaceController,
  ],
  providers: [
    MarketplaceService,
    {
      provide: MARKETPLACE_REPOSITORY,
      useClass: PrismaMarketplaceRepository,
    },
  ],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
