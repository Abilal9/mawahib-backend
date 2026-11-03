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

/**
 * How long one health response waits for the shared database probe.
 * Midpoint of the 2–3s readiness window: long enough for a normal
 * SELECT 1, and shorter than Prisma's default 10s pool wait.
 * Expiry returns a response. It does not cancel the query.
 */
export const HEALTH_PROBE_RESPONSE_DEADLINE_MS = 2_500;

@Injectable()
export class HealthService {
  /**
   * The one database probe health requests may share. Cleared only when
   * that operation settles, never when an HTTP deadline expires.
   */
  private inFlight: Promise<DatabaseStatus> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const database = await this.databaseStatus();
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

  private databaseStatus(): Promise<DatabaseStatus> {
    const probe = this.sharedProbe();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<DatabaseStatus>((resolve) => {
      timer = setTimeout(() => {
        resolve('disconnected');
      }, HEALTH_PROBE_RESPONSE_DEADLINE_MS);
    });

    return Promise.race([probe, deadline]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
  }

  private sharedProbe(): Promise<DatabaseStatus> {
    if (this.inFlight) {
      return this.inFlight;
    }

    let tracked!: Promise<DatabaseStatus>;
    tracked = this.prisma.checkConnectivity().then(
      (status) => {
        this.release(tracked);
        return status;
      },
      () => {
        this.release(tracked);
        return 'disconnected' as const;
      },
    );
    this.inFlight = tracked;
    return tracked;
  }

  /** An older probe must not clear a probe that replaced it. */
  private release(operation: Promise<DatabaseStatus>): void {
    if (this.inFlight === operation) {
      this.inFlight = null;
    }
  }
}
