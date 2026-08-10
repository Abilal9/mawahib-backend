import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.schema';

export type DatabaseStatus = 'connected' | 'disconnected' | 'not_configured';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private configured: boolean;
  private connected = false;

  constructor(private readonly config: ConfigService<Env, true>) {
    const databaseUrl = config.get('DATABASE_URL', { infer: true });
    // Prisma requires a URL at construct time; use a local placeholder when unset
    // so the app can boot before credentials exist (health → not_configured).
    super({
      datasources: {
        db: {
          url:
            databaseUrl ??
            'postgresql://postgres:postgres@127.0.0.1:5432/mawahib_unconfigured',
        },
      },
      log: ['warn', 'error'],
    });
    this.configured = Boolean(databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    if (!this.configured) {
      this.logger.warn(
        'DATABASE_URL is not set — Prisma will stay disconnected (db: not_configured).',
      );
      return;
    }

    try {
      await this.$connect();
      this.connected = true;
      this.logger.log('Prisma connected to PostgreSQL');
    } catch (error) {
      this.connected = false;
      this.logger.error(
        'Prisma failed to connect — health will report db as disconnected',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.configured) {
      await this.$disconnect();
      this.connected = false;
    }
  }

  getDatabaseStatus(): DatabaseStatus {
    if (!this.configured) {
      return 'not_configured';
    }
    return this.connected ? 'connected' : 'disconnected';
  }
}
