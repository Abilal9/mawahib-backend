import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env.schema';

/**
 * Server-side Supabase client (secret key) for Auth admin / Storage later.
 * Domain data access goes through Prisma — do not use supabase.from() for
 * application tables in controllers or services.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const secretKey = this.config.get('SUPABASE_SECRET_KEY', { infer: true });

    if (url && secretKey) {
      this.client = createClient(url, secretKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      this.logger.log('Supabase server client: configured');
    } else {
      this.client = null;
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_SECRET_KEY not set — Supabase client unavailable',
      );
    }
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getStatus(): 'configured' | 'not_configured' {
    return this.client ? 'configured' : 'not_configured';
  }
}
