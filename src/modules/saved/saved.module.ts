import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { PostsModule } from '../posts/posts.module';
import { ServicesModule } from '../services/services.module';
import { SavedController } from './saved.controller';

@Module({
  imports: [PostsModule, MarketplaceModule, ServicesModule],
  controllers: [SavedController],
})
export class SavedModule {}
