import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { POSTS_REPOSITORY } from './repositories/posts.repository';
import { PrismaPostsRepository } from './repositories/prisma-posts.repository';

@Module({
  imports: [MediaModule, NotificationsModule],
  controllers: [PostsController],
  providers: [
    PostsService,
    {
      provide: POSTS_REPOSITORY,
      useClass: PrismaPostsRepository,
    },
  ],
  exports: [PostsService],
})
export class PostsModule {}
