import { Module } from '@nestjs/common';
import { ExpoPushClient } from './expo-push.client';
import { PrismaPushStore } from './prisma-push.store';
import { PushController } from './push.controller';
import { PushDeliveryRunner } from './push-delivery.runner';
import { CHAT_PUSH_RECORDER, PushService } from './push.service';
import { PUSH_STORE } from './push.store';

@Module({
  controllers: [PushController],
  providers: [
    PushService,
    PrismaPushStore,
    ExpoPushClient,
    PushDeliveryRunner,
    { provide: PUSH_STORE, useExisting: PrismaPushStore },
    { provide: CHAT_PUSH_RECORDER, useExisting: PushService },
  ],
  exports: [CHAT_PUSH_RECORDER, PushService],
})
export class PushModule {}
