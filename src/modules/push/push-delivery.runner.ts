import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ExpoPushClient } from './expo-push.client';
import { pushNotificationsEnabled } from './push-policy';
import { PushService } from './push.service';

const POLL_MS = 15_000;

@Injectable()
export class PushDeliveryRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushDeliveryRunner.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly push: PushService,
    private readonly expo: ExpoPushClient,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (!pushNotificationsEnabled()) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.warn(
          `Chat push pass failed: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      });
    }, POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (!pushNotificationsEnabled()) return;
    await this.push.processOutbox();
    await this.push.processOne(this.expo);
    await this.push.processReceipts(this.expo);
  }
}
