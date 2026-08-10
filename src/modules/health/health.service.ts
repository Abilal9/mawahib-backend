import { Injectable } from '@nestjs/common';
import {
  DatabaseStatus,
  PrismaService,
} from '../../infrastructure/database/prisma.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export type SupabaseStatus = 'configured' | 'not_configured';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  database: DatabaseStatus;
  supabase: SupabaseStatus;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const database = await this.prisma.checkConnectivity();
    const supabase = this.supabase.getStatus();
    const healthy = database === 'connected' && supabase === 'configured';

    return {
      status: healthy ? 'ok' : 'degraded',
      service: 'mawahib-backend',
      timestamp: new Date().toISOString(),
      database,
      supabase,
    };
  }
}
