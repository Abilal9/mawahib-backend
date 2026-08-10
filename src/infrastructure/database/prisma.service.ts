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
    // so tests can boot without credentials (health → not_configured).
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
      // Safe connectivity probe — no schema changes.
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      this.logger.log('DATABASE_URL: configured');
      this.logger.log('Prisma connected to PostgreSQL');
    } catch {
      this.connected = false;
      this.logger.error(
        'Prisma failed to connect to PostgreSQL — health will report database as disconnected (details omitted)',
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

  /** Live probe used by health when already configured. */
  async checkConnectivity(): Promise<DatabaseStatus> {
    if (!this.configured) {
      return 'not_configured';
    }

    try {
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      return 'connected';
    } catch {
      this.connected = false;
      return 'disconnected';
    }
  }
}
