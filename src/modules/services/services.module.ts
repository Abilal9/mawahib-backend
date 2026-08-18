import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';
import {
  MyServicesController,
  PublicServicesController,
} from './services.controller';
import { ServicesService } from './services.service';
import { SERVICE_OFFERING_REPOSITORY } from './repositories/service-offering.repository';
import { PrismaServiceOfferingRepository } from './repositories/prisma-service-offering.repository';

@Module({
  imports: [MediaModule, UsersModule],
  controllers: [MyServicesController, PublicServicesController],
  providers: [
    ServicesService,
    {
      provide: SERVICE_OFFERING_REPOSITORY,
      useClass: PrismaServiceOfferingRepository,
    },
  ],
  exports: [ServicesService],
})
export class ServicesModule {}
