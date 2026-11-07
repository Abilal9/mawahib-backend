import { Inject, Injectable, Optional } from '@nestjs/common';
import { HealthService } from '../health/health.service';
import {
  readOperationsConfig,
  type OperationsConfig,
} from './operations.config';
import {
  card,
  dashboardFor,
  malformedCard,
  mapIncidents,
  mapMonitor,
  mapRailwayDeployment,
  mapSupabaseBackup,
  mapSupabaseProject,
  notConfigured,
  railwayConfigured,
  supabaseConfigured,
  timeoutCard,
  titleFor,
  unavailable,
  uptimeConfigured,
} from './operations.map';
import {
  FAILURE_SUMMARY,
  OPERATIONS_FRESH_MS,
  OPERATIONS_STALE_MS,
  OPERATIONS_TIMEOUT_MS,
  RATE_SUMMARY,
  SUPABASE_DASHBOARD_URL,
  type OperationsOverview,
  type OpsCard,
  type OpsCardId,
} from './operations.types';

export const OPERATIONS_BINDINGS = Symbol('OPERATIONS_BINDINGS');

const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const SUPABASE_API = 'https://api.supabase.com';
const UPTIME_API = 'https://api.uptimerobot.com';
const BODY_LIMIT = 256_000;

const RAILWAY_SCOPE_QUERY = `query OperationsProjectToken { projectToken { projectId environmentId } }`;
const RAILWAY_DEPLOYMENT_QUERY = `query OperationsDeployment($projectId: String!, $environmentId: String!, $serviceId: String!) {
  deployments(first: 10, input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }) {
    edges { node { id status createdAt serviceId meta } }
  }
}`;

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export type OperationsBindings = {
  config: () => OperationsConfig;
  fetch: FetchImpl;
  now: () => number;
};

type CacheEntry = {
  fetchedAtMs: number;
  card: OpsCard;
};

class ProviderFailure extends Error {
  constructor(
    readonly kind: 'timeout' | 'http' | 'malformed' | 'rate' | 'not_available',
    readonly result?: OpsCard,
  ) {
    super('provider');
  }
}

@Injectable()
export class OperationsService {
  private readonly cache = new Map<OpsCardId, CacheEntry>();
  private readonly inflight = new Map<OpsCardId, Promise<OpsCard>>();
  private readonly bindings: OperationsBindings;

  constructor(
    private readonly health: HealthService,
    @Optional()
    @Inject(OPERATIONS_BINDINGS)
    bindings?: Partial<OperationsBindings>,
  ) {
    this.bindings = {
      config: bindings?.config ?? readOperationsConfig,
      fetch: bindings?.fetch ?? ((input, init) => fetch(input, init)),
      now: bindings?.now ?? (() => Date.now()),
    };
  }

  async overview(): Promise<OperationsOverview> {
    const config = this.bindings.config();
    const cards = await Promise.all([
      this.safely('railway', () => this.railway(config)),
      this.safely('database', () => this.database()),
      this.safely('supabase_project', () => this.supabaseProject(config)),
      this.safely('supabase_backup', () => this.supabaseBackup(config)),
      this.safely('uptime', () => this.uptime(config)),
    ]);
    return { generatedAt: new Date(this.bindings.now()).toISOString(), cards };
  }

  private async safely(id: OpsCardId, load: () => Promise<OpsCard>): Promise<OpsCard> {
    try {
      return await load();
    } catch {
      return unavailable(id, FAILURE_SUMMARY);
    }
  }

  private railway(config: OperationsConfig): Promise<OpsCard> {
    if (!railwayConfigured(config)) {
      return Promise.resolve(
        notConfigured(
          'railway',
          titleFor('railway'),
          'Deployment status is not set up. This does not mean the API is down.',
          [
            {
              label: 'Setup',
              value:
                'Set OPS_RAILWAY_PROJECT_ACCESS_TOKEN on the server. Railway supplies the service id. A project token is limited to one environment and can read that environment; it is not a read-only credential. The service-role key is not a Railway credential.',
            },
          ],
        ),
      );
    }
    return this.cached('railway', (signal) => this.loadRailway(config, signal));
  }

  private supabaseProject(config: OperationsConfig): Promise<OpsCard> {
    if (!supabaseConfigured(config)) {
      return Promise.resolve(
        notConfigured(
          'supabase_project',
          titleFor('supabase_project'),
          'Project status is not set up. This does not mean the database is down.',
          [
            {
              label: 'Setup',
              value:
                'Set OPS_SUPABASE_ACCESS_TOKEN for the application project mrtsjgrsponzqrzptymg. The token needs project_admin_read for project status. It is not the service-role key and it is not the staff-auth project.',
            },
          ],
        ),
      );
    }
    return this.cached('supabase_project', (signal) => this.loadProject(config, signal));
  }

  private supabaseBackup(config: OperationsConfig): Promise<OpsCard> {
    if (!supabaseConfigured(config)) {
      return Promise.resolve(
        notConfigured(
          'supabase_backup',
          titleFor('supabase_backup'),
          'Backup status is not set up. A database connection does not provide it.',
          [
            {
              label: 'Setup',
              value:
                'Backup status uses the same OPS_SUPABASE_ACCESS_TOKEN with backups_read on the application project. A database connection does not provide backup status. The free plan may not return backups.',
            },
          ],
        ),
      );
    }
    return this.cached('supabase_backup', (signal) => this.loadBackup(config, signal));
  }

  private uptime(config: OperationsConfig): Promise<OpsCard> {
    if (!uptimeConfigured(config)) {
      return Promise.resolve(
        notConfigured(
          'uptime',
          titleFor('uptime'),
          'The production monitor is not set up. This does not mean the service is down.',
          [
            {
              label: 'Setup',
              value:
                'Set OPS_UPTIMEROBOT_READ_TOKEN and OPS_UPTIMEROBOT_MONITOR_ID on the server. Use a read-only key. The portal does not pause, start, or reset monitors.',
            },
          ],
        ),
      );
    }
    return this.cached('uptime', (signal) => this.loadUptime(config, signal));
  }

  private async database(): Promise<OpsCard> {
    return this.cached('database', async () => {
      const status = await this.health.sharedConnectivity();
      if (status === 'not_configured') {
        return notConfigured(
          'database',
          titleFor('database'),
          'Database connectivity is not set up.',
          [
            {
              label: 'Setup',
              value: 'Database connectivity uses the existing application database setting.',
            },
          ],
        );
      }
      if (status !== 'connected') {
        return unavailable(
          'database',
          'The database connectivity check failed or timed out. This is not a confirmed outage.',
        );
      }
      return card({
        id: 'database',
        title: titleFor('database'),
        state: 'up',
        summary:
          'The application database accepted a connectivity check. This is separate from Supabase project status and backup status.',
        details: [{ label: 'Check', value: 'SELECT 1' }],
        dashboardUrl: SUPABASE_DASHBOARD_URL,
      });
    });
  }

  private async cached(
    id: OpsCardId,
    load: (signal: AbortSignal) => Promise<OpsCard>,
  ): Promise<OpsCard> {
    const now = this.bindings.now();
    const cached = this.cache.get(id);
    if (cached && now - cached.fetchedAtMs < OPERATIONS_FRESH_MS) {
      return copyCard(cached.card, false);
    }
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const run = this.refresh(id, load, cached ?? null);
    this.inflight.set(id, run);
    try {
      return await run;
    } finally {
      if (this.inflight.get(id) === run) this.inflight.delete(id);
    }
  }

  private async refresh(
    id: OpsCardId,
    load: (signal: AbortSignal) => Promise<OpsCard>,
    previous: CacheEntry | null,
  ): Promise<OpsCard> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPERATIONS_TIMEOUT_MS);
    try {
      const loaded = await load(controller.signal);
      if (loaded.state === 'unavailable') return this.keepStaleOr(previous, loaded);
      const fetchedAtMs = this.bindings.now();
      const stored = copyCard(
        { ...loaded, fetchedAt: new Date(fetchedAtMs).toISOString() },
        false,
      );
      this.cache.set(id, { fetchedAtMs, card: stored });
      return stored;
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === 'not_available' && error.result) {
        const now = this.bindings.now();
        if (previous && now - previous.fetchedAtMs < OPERATIONS_STALE_MS) {
          return copyCard(previous.card, true);
        }
        const stored = copyCard(
          { ...error.result, fetchedAt: new Date(now).toISOString() },
          false,
        );
        this.cache.set(id, { fetchedAtMs: now, card: stored });
        return stored;
      }
      return this.keepStaleOr(previous, failureCard(id, error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadRailway(config: OperationsConfig, signal: AbortSignal): Promise<OpsCard> {
    const token = config.railwayProjectToken as string;
    const serviceId = config.railwayServiceId as string;
    let projectId = config.railwayProjectId;
    let environmentId = config.railwayEnvironmentId;
    if (!projectId || !environmentId) {
      const scope = await this.graphql(token, RAILWAY_SCOPE_QUERY, {}, signal);
      const tokenScope = asRecord(asRecord(scope.data)?.projectToken);
      projectId = uuid(tokenScope?.projectId);
      environmentId = uuid(tokenScope?.environmentId);
    }
    if (!projectId || !environmentId) return malformedCard('railway');
    const body = await this.graphql(
      token,
      RAILWAY_DEPLOYMENT_QUERY,
      { projectId, environmentId, serviceId },
      signal,
    );
    return mapRailwayDeployment(body, serviceId);
  }

  private async graphql(
    token: string,
    query: string,
    variables: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const body = await this.send(
      RAILWAY_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Project-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      },
      signal,
    );
    if (!Array.isArray(body.errors)) return body;
    if (body.errors.length > 0) throw new ProviderFailure('malformed');
    return body;
  }

  private async loadProject(config: OperationsConfig, signal: AbortSignal): Promise<OpsCard> {
    const ref = config.supabaseProjectRef as string;
    const body = await this.getJson(
      `${SUPABASE_API}/v1/projects/${ref}`,
      config.supabaseManagementToken as string,
      signal,
      'supabase_project',
    );
    return mapSupabaseProject(body, ref);
  }

  private async loadBackup(config: OperationsConfig, signal: AbortSignal): Promise<OpsCard> {
    const ref = config.supabaseProjectRef as string;
    try {
      const body = await this.getJson(
        `${SUPABASE_API}/v1/projects/${ref}/database/backups`,
        config.supabaseManagementToken as string,
        signal,
        'supabase_backup',
      );
      return mapSupabaseBackup(body, ref, this.bindings.now());
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === 'not_available') {
        throw new ProviderFailure(
          'not_available',
          card({
            id: 'supabase_backup',
            title: titleFor('supabase_backup'),
            state: 'not_available',
            summary: 'Backup status is not available with the current token or plan.',
            details: [{ label: 'Project', value: ref }],
            dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${ref}`,
          }),
        );
      }
      throw error;
    }
  }

  private async loadUptime(config: OperationsConfig, signal: AbortSignal): Promise<OpsCard> {
    const monitorId = config.uptimeMonitorId as string;
    const token = config.uptimeReadToken as string;
    const monitor = mapMonitor(
      await this.getJson(`${UPTIME_API}/v3/monitors/${monitorId}`, token, signal, 'uptime'),
      monitorId,
    );
    if (!monitor) return malformedCard('uptime');
    try {
      const incidents = mapIncidents(
        await this.getJson(
          `${UPTIME_API}/v3/incidents?monitor_id=${monitorId}`,
          token,
          signal,
          'uptime',
        ),
      );
      if (!incidents) {
        return {
          ...monitor,
          details: [
            ...monitor.details,
            {
              label: 'Incidents',
              value: 'The first page did not include an incident list.',
            },
          ],
        };
      }
      return {
        ...monitor,
        incidents,
        details: [
          ...monitor.details,
          {
            label: 'Incidents',
            value:
              'First page only. The API documents filters, not that this page is the newest incidents.',
          },
        ],
      };
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === 'timeout') throw error;
      return {
        ...monitor,
        details: [
          ...monitor.details,
          {
            label: 'Incidents',
            value: 'The first page could not be loaded. This is not a monitor outage.',
          },
        ],
      };
    }
  }

  private async getJson(
    url: string,
    token: string,
    signal: AbortSignal,
    id: OpsCardId,
  ): Promise<unknown> {
    assertFixedUrl(url, id);
    const response = await this.request(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      },
      signal,
    );
    if (response.status === 429) throw new ProviderFailure('rate');
    if (
      id === 'supabase_backup' &&
      (response.status === 402 || response.status === 403 || response.status === 404)
    ) {
      throw new ProviderFailure('not_available');
    }
    if (!response.ok) throw new ProviderFailure('http');
    return readJson(response);
  }

  private async send(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(url, init, signal);
    if (response.status === 429) throw new ProviderFailure('rate');
    if (!response.ok) throw new ProviderFailure('http');
    const body = await readJson(response);
    const record = asRecord(body);
    if (!record) throw new ProviderFailure('malformed');
    return record;
  }

  private async request(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    try {
      return await this.bindings.fetch(url, { ...init, signal });
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw new ProviderFailure('timeout');
      throw new ProviderFailure('http');
    }
  }

  private keepStaleOr(previous: CacheEntry | null, fallback: OpsCard): OpsCard {
    const now = this.bindings.now();
    if (previous && now - previous.fetchedAtMs < OPERATIONS_STALE_MS) {
      return copyCard(previous.card, true);
    }
    return copyCard({ ...fallback, fetchedAt: new Date(now).toISOString() }, false);
  }
}

function copyCard(card: OpsCard, stale: boolean): OpsCard {
  return {
    ...card,
    stale,
    details: card.details.map((detail) => ({ ...detail })),
    incidents: card.incidents.map((incident) => ({ ...incident })),
  };
}

function failureCard(id: OpsCardId, error: unknown): OpsCard {
  if (error instanceof ProviderFailure) {
    if (error.kind === 'timeout') return timeoutCard(id);
    if (error.kind === 'rate') return unavailable(id, RATE_SUMMARY);
    if (error.kind === 'malformed') return malformedCard(id);
  }
  const result = unavailable(id, FAILURE_SUMMARY);
  result.dashboardUrl = dashboardFor(id);
  return result;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > BODY_LIMIT) throw new ProviderFailure('malformed');
  if (!text) throw new ProviderFailure('malformed');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderFailure('malformed');
  }
}

function assertFixedUrl(url: string, id: OpsCardId) {
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.protocol !== 'https:') {
    throw new ProviderFailure('http');
  }
  if (id === 'uptime' && parsed.origin !== UPTIME_API) throw new ProviderFailure('http');
  if ((id === 'supabase_project' || id === 'supabase_backup') && parsed.origin !== SUPABASE_API) {
    throw new ProviderFailure('http');
  }
  if (id === 'railway') throw new ProviderFailure('http');
}

function isAbort(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function uuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
