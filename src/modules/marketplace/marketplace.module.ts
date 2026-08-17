import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  ApplicationsController,
  EngagementsController,
  JobListingsController,
  MyMarketplaceController,
  WorkRequestsController,
} from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MARKETPLACE_REPOSITORY } from './repositories/marketplace.repository';
import { PrismaMarketplaceRepository } from './repositories/prisma-marketplace.repository';

@Module({
  imports: [UsersModule, MessagingModule, NotificationsModule],
  controllers: [
    JobListingsController,
    ApplicationsController,
    EngagementsController,
    WorkRequestsController,
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
