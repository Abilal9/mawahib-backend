import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Injectable()
export class StorageBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(StorageBootstrapService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async onModuleInit(): Promise<void> {
    if (!this.supabase.isConfigured()) return;
    try {
      await this.supabase.ensureBuckets();
    } catch (err) {
      this.logger.warn(
        `Storage bucket bootstrap skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
