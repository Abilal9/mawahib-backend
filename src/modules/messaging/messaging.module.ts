import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MESSAGING_REPOSITORY } from './repositories/messaging.repository';
import { PrismaMessagingRepository } from './repositories/prisma-messaging.repository';

@Module({
  imports: [NotificationsModule, UsersModule, MediaModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    {
      provide: MESSAGING_REPOSITORY,
      useClass: PrismaMessagingRepository,
    },
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
