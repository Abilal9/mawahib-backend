import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { CONNECTIONS_REPOSITORY } from './repositories/connections.repository';
import { PrismaConnectionsRepository } from './repositories/prisma-connections.repository';

@Module({
  imports: [MessagingModule, NotificationsModule, UsersModule],
  controllers: [ConnectionsController],
  providers: [
    ConnectionsService,
    {
      provide: CONNECTIONS_REPOSITORY,
      useClass: PrismaConnectionsRepository,
    },
  ],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
