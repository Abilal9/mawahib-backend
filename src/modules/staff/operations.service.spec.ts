import { HealthService } from '../health/health.service';
import type { OperationsConfig } from './operations.config';
import { OperationsService } from './operations.service';
import type { OpsCard, OpsCardId } from './operations.types';

const SERVICE = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ENVIRONMENT = '33333333-3333-4333-8333-333333333333';
const REF = 'abcdefghijklmnopqrst';
const TOKEN = 'project-token-value';
const MANAGEMENT = 'management-token-value';
const UPTIME = 'uptimerobot-read-token';

const configured: OperationsConfig = {
  railwayProjectToken: TOKEN,
  railwayProjectId: PROJECT,
  railwayEnvironmentId: ENVIRONMENT,
  railwayServiceId: SERVICE,
  supabaseManagementToken: MANAGEMENT,
  supabaseProjectRef: REF,
  uptimeReadToken: UPTIME,
  uptimeMonitorId: '794581023',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function card(overview: { cards: OpsCard[] }, id: OpsCardId): OpsCard {
  const found = overview.cards.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function harness(input: {
  config?: OperationsConfig;
  connectivity?: () => Promise<'connected' | 'disconnected' | 'not_configured'>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let now = Date.parse('2026-11-05T10:00:00.000Z');
  const connectivity = jest.fn(
    input.connectivity ?? (async () => 'connected' as const),
  );
  const service = new OperationsService(
    { sharedConnectivity: connectivity } as unknown as HealthService,
    {
      config: () => input.config ?? configured,
      now: () => now,
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (!input.fetch) throw new Error('unexpected fetch');
        return input.fetch(url, init);
      },
    },
  );
  return {
    service,
    calls,
    connectivity,
    at: (iso: string) => {
      now = Date.parse(iso);
    },
  };
}

function railwayDeployment(status: string, meta: unknown = { commitHash: 'abc1234def' }) {
  return {
    data: {
      deployments: {
        edges: [
          {
            node: {
              id: '44444444-4444-4444-8444-444444444444',
              status,
              createdAt: '2026-11-05T09:00:00.000Z',
              serviceId: SERVICE,
              meta,
            },
          },
        ],
      },
    },
  };
}

describe('OperationsService', () => {
  const empty: OperationsConfig = {
    railwayProjectToken: null,
    railwayProjectId: null,
    railwayEnvironmentId: null,
    railwayServiceId: null,
    supabaseManagementToken: null,
    supabaseProjectRef: null,
    uptimeReadToken: null,
    uptimeMonitorId: null,
  };

  it('reports missing credentials without calling a provider', async () => {
    const { service, calls } = harness({ config: empty, connectivity: async () => 'not_configured' });
    const overview = await service.overview();
    expect(calls).toHaveLength(0);
    expect(overview.cards.map((item) => item.state)).toEqual([
      'not_configured',
      'not_configured',
      'not_configured',
      'not_configured',
      'not_configured',
    ]);
    expect(overview.cards.filter((item) => item.id !== 'database').every((item) => item.fetchedAt === null)).toBe(true);
    expect(card(overview, 'database').fetchedAt).toBe(overview.generatedAt);
    expect(card(overview, 'railway').summary).not.toContain('OPS_');
    expect(card(overview, 'railway').details.map((detail) => detail.value).join(' ')).toContain(
      'OPS_RAILWAY_PROJECT_ACCESS_TOKEN',
    );
    expect(card(overview, 'uptime').summary).not.toContain('OPS_');
  });

  it('keeps one provider failure from clearing the other cards', async () => {
    const { service } = harness({
      fetch: async (url) => {
        if (url.includes('backboard.railway.com')) throw new Error('socket');
        if (url.endsWith(`/v1/projects/${REF}`)) {
          return json({ status: 'ACTIVE_HEALTHY', database: { host: 'db.secret.internal' } });
        }
        if (url.endsWith('/database/backups')) {
          return json({
            backups: [{ status: 'COMPLETED', inserted_at: '2026-11-04T00:00:00.000Z' }],
            physical_backup_data: { latest_physical_backup_date_unix: 0 },
          });
        }
        if (url.endsWith('/monitors/794581023')) {
          return json({ status: 'UP', interval: 300, apiKey: 'super-secret-api-key' });
        }
        if (url.includes('/incidents?')) return json({ nextLink: null, data: [] });
        return json({ unexpected: true }, 500);
      },
    });
    const overview = await service.overview();
    expect(card(overview, 'railway').state).toBe('unavailable');
    expect(card(overview, 'railway').summary).toBe(
      'The provider request failed. This is not a confirmed outage.',
    );
    expect(card(overview, 'database').state).toBe('up');
    expect(card(overview, 'supabase_project').state).toBe('up');
    expect(card(overview, 'supabase_backup').state).toBe('up');
    expect(card(overview, 'uptime').state).toBe('up');
    const encoded = JSON.stringify(overview);
    expect(encoded).not.toContain('db.secret.internal');
    expect(encoded).not.toContain('super-secret-api-key');
    expect(encoded).not.toContain(TOKEN);
    expect(encoded).not.toContain(MANAGEMENT);
    expect(encoded).not.toContain(UPTIME);
  });

  it('maps provider statuses without treating progress, pause, or timeout as down', async () => {
    const cases: Array<{ railway: string; monitor: string; railwayState: string; monitorState: string }> = [
      { railway: 'SUCCESS', monitor: 'UP', railwayState: 'up', monitorState: 'up' },
      { railway: 'FAILED', monitor: 'DOWN', railwayState: 'unknown', monitorState: 'down' },
      { railway: 'CRASHED', monitor: 'LOOKS_DOWN', railwayState: 'down', monitorState: 'degraded' },
      { railway: 'BUILDING', monitor: 'PAUSED', railwayState: 'unknown', monitorState: 'paused' },
      { railway: 'SLEEPING', monitor: 'STARTED', railwayState: 'unknown', monitorState: 'unknown' },
      { railway: 'MYSTERY', monitor: 'MYSTERY', railwayState: 'unknown', monitorState: 'unknown' },
    ];
    for (const item of cases) {
      const { service } = harness({
        fetch: async (url) => {
          if (url.includes('backboard.railway.com')) return json(railwayDeployment(item.railway));
          if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'COMING_UP' });
          if (url.endsWith('/database/backups')) return json({ backups: [], physical_backup_data: {} });
          if (url.includes('/monitors/')) return json({ status: item.monitor, interval: 60 });
          return json({ nextLink: null, data: [] });
        },
      });
      const overview = await service.overview();
      expect(card(overview, 'railway').state).toBe(item.railwayState);
      if (item.railway === 'SUCCESS') {
        expect(card(overview, 'railway').summary).toContain(
          'not continuous application-health proof',
        );
      }
      if (item.railway === 'FAILED') {
        expect(card(overview, 'railway').summary).toContain('not labeled down');
      }
      expect(card(overview, 'uptime').state).toBe(item.monitorState);
      expect(card(overview, 'supabase_project').state).toBe('unknown');
      expect(card(overview, 'supabase_backup').state).toBe('not_available');
    }
  });

  it('reads the release, backup time, interval, and incidents, and leaves last check uninvented', async () => {
    const { service, calls } = harness({
      fetch: async (url, init) => {
        if (url !== 'https://backboard.railway.com/graphql/v2') {
          if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'ACTIVE_UNHEALTHY' });
          if (url.endsWith('/database/backups')) {
            return json({
              backups: [
                { status: 'FAILED', inserted_at: '2026-11-01T00:00:00.000Z', id: 4 },
                { status: 'COMPLETED', inserted_at: '2026-11-03T00:00:00.000Z', id: 9 },
              ],
            });
          }
          if (url.endsWith('/monitors/794581023')) return json({ status: 'DOWN', interval: 300 });
          expect(url).toBe('https://api.uptimerobot.com/v3/incidents?monitor_id=794581023');
          return json({
            nextLink: 'https://evil.example/next',
            data: [
              { status: 'resolved', reason: 'Bearer secret-token', startedAt: '2026-11-05T08:00:00.000Z' },
              { status: 'DOWN', startedAt: 'not-a-date' },
              { status: 'DOWN', startedAt: '2026-11-05T07:00:00.000Z' },
              { status: 'DOWN', startedAt: '2026-11-05T06:00:00.000Z' },
              { status: 'DOWN', startedAt: '2026-11-05T05:00:00.000Z' },
              { status: 'DOWN', startedAt: '2026-11-05T04:00:00.000Z' },
            ],
          });
        }
        const posted = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> };
        expect(posted.query).toContain('first: 10');
        expect(posted.query).not.toMatch(/mutation|redeploy|rollback|restart|stop/i);
        expect(posted.variables).toEqual({
          projectId: PROJECT,
          environmentId: ENVIRONMENT,
          serviceId: SERVICE,
        });
        expect(new Headers(init.headers).get('Project-Access-Token')).toBe(TOKEN);
        expect(new Headers(init.headers).get('Authorization')).toBeNull();
        return json(railwayDeployment('SUCCESS', { commitHash: 'ABC1234', commitMessage: 'do not copy' }));
      },
    });
    const overview = await service.overview();
    const railway = card(overview, 'railway');
    expect(railway.state).toBe('up');
    expect(railway.eventAt).toBe('2026-11-05T09:00:00.000Z');
    expect(railway.details).toContainEqual({ label: 'Release', value: 'abc1234' });
    expect(JSON.stringify(railway)).not.toContain('do not copy');
    expect(card(overview, 'supabase_project').state).toBe('down');
    const backup = card(overview, 'supabase_backup');
    expect(backup.state).toBe('up');
    expect(backup.eventAt).toBe('2026-11-03T00:00:00.000Z');
    expect(backup.summary).toContain('does not prove it can be restored');
    const uptime = card(overview, 'uptime');
    expect(uptime.details).toContainEqual({ label: 'Interval', value: '300 seconds' });
    expect(uptime.details).toContainEqual({ label: 'Last check', value: 'Not exposed by the API' });
    expect(uptime.incidents).toHaveLength(5);
    expect(uptime.incidents[0]?.at).toBe('2026-11-05T08:00:00.000Z');
    expect(JSON.stringify(uptime)).not.toContain('most recent');
    expect(uptime.details).toContainEqual({
      label: 'Incidents',
      value: 'First page only. The API documents filters, not that this page is the newest incidents.',
    });
    expect(JSON.stringify(uptime)).not.toContain('secret-token');
    expect(JSON.stringify(uptime)).not.toContain('evil.example');
    expect(calls.every((call) => call.url.startsWith('https://'))).toBe(true);
  });

  it('uses a fixed host even when a caller-shaped id is supplied', async () => {
    const { service, calls } = harness({
      config: {
        ...configured,
        railwayServiceId: 'https://evil.example/service',
        railwayProjectId: 'https://evil.example/project',
        supabaseProjectRef: 'https://evil.example',
        uptimeMonitorId: 'https://evil.example/monitor',
      },
    });
    const overview = await service.overview();
    expect(calls).toHaveLength(0);
    expect(overview.cards.filter((item) => item.id !== 'database').every((item) => item.state === 'not_configured')).toBe(true);
  });

  it('treats a timeout and a secret-bearing error body as unavailable, not down', async () => {
    jest.useFakeTimers();
    const hanging = harness({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          init.signal?.addEventListener('abort', abort);
        }),
    });
    const pending = hanging.service.overview();
    await jest.advanceTimersByTimeAsync(4_000);
    const timedOut = await pending;
    expect(card(timedOut, 'railway').state).toBe('unavailable');
    expect(card(timedOut, 'railway').summary).toContain('not a confirmed outage');
    expect(card(timedOut, 'railway').state).not.toBe('down');
    jest.useRealTimers();

    const rejected = harness({
      fetch: async () => json({ error: 'token sk_live_secret', apiKey: 'another-secret' }, 500),
    });
    const failed = await rejected.service.overview();
    expect(card(failed, 'railway').state).toBe('unavailable');
    expect(JSON.stringify(failed)).not.toContain('sk_live_secret');
    expect(JSON.stringify(failed)).not.toContain('another-secret');
  });

  it('shares one refresh, expires it, and keeps the old timestamp when the next read fails', async () => {
    let railwayCalls = 0;
    const { service, at } = harness({
      fetch: async (url) => {
        if (url.includes('backboard.railway.com')) {
          railwayCalls += 1;
          if (railwayCalls > 1) return json({ errors: [{ message: 'sk_live_secret' }] });
          return json(railwayDeployment('SUCCESS'));
        }
        if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'ACTIVE_HEALTHY' });
        if (url.endsWith('/database/backups')) return json({ backups: [] });
        if (url.includes('/monitors/')) return json({ status: 'UP', interval: 60 });
        return json({ nextLink: null, data: [] });
      },
    });
    let release: (response: Response) => void = () => undefined;
    const blocked = harness({
      fetch: (url) => {
        if (!url.includes('backboard.railway.com')) return Promise.resolve(json({ status: 'ACTIVE_HEALTHY', backups: [], nextLink: null, data: [] }));
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const firstShare = blocked.service.overview();
    const secondShare = blocked.service.overview();
    release(json(railwayDeployment('SUCCESS')));
    const [sharedA, sharedB] = await Promise.all([firstShare, secondShare]);
    expect(blocked.calls.filter((call) => call.url.includes('backboard.railway.com'))).toHaveLength(1);
    expect(card(sharedA, 'railway')).toEqual(card(sharedB, 'railway'));

    const fresh = await service.overview();
    const again = await service.overview();
    expect(railwayCalls).toBe(1);
    expect(card(again, 'railway').fetchedAt).toBe(card(fresh, 'railway').fetchedAt);
    expect(card(again, 'railway').stale).toBe(false);

    at('2026-11-05T10:01:01.000Z');
    const stale = await service.overview();
    expect(railwayCalls).toBe(2);
    expect(card(stale, 'railway').stale).toBe(true);
    expect(card(stale, 'railway').state).toBe('up');
    expect(card(stale, 'railway').fetchedAt).toBe(card(fresh, 'railway').fetchedAt);
    expect(stale.generatedAt).toBe('2026-11-05T10:01:01.000Z');
    expect(JSON.stringify(stale)).not.toContain('sk_live_secret');

    at('2026-11-05T10:12:00.000Z');
    const expired = await service.overview();
    expect(card(expired, 'railway').stale).toBe(false);
    expect(card(expired, 'railway').state).toBe('unavailable');
  });

  it('does not let a failed deployment attempt hide or replace the serving deployment', async () => {
    const { service } = harness({
      fetch: async (url) => {
        if (url.includes('backboard.railway.com')) {
          return json({
            data: {
              deployments: {
                edges: [
                  {
                    node: {
                      id: '55555555-5555-4555-8555-555555555555',
                      status: 'FAILED',
                      createdAt: '2026-11-05T09:30:00.000Z',
                      serviceId: SERVICE,
                      meta: { commitHash: 'bbbbbbb' },
                    },
                  },
                  {
                    node: {
                      id: '44444444-4444-4444-8444-444444444444',
                      status: 'SUCCESS',
                      createdAt: '2026-11-05T09:00:00.000Z',
                      serviceId: SERVICE,
                      meta: { commitHash: 'abc1234' },
                    },
                  },
                ],
              },
            },
          });
        }
        if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'ACTIVE_HEALTHY' });
        if (url.endsWith('/database/backups')) return json({ backups: [] });
        if (url.includes('/monitors/')) return json({ status: 'UP', interval: 60 });
        return json({ nextLink: null, data: [] });
      },
    });
    const overview = await service.overview();
    const railway = card(overview, 'railway');
    expect(railway.state).toBe('up');
    expect(railway.eventAt).toBe('2026-11-05T09:00:00.000Z');
    expect(railway.details).toContainEqual({ label: 'Release', value: 'abc1234' });
    expect(railway.details).toContainEqual({ label: 'Latest attempt', value: 'FAILED' });
    expect(JSON.stringify(railway)).not.toContain('bbbbbbb');
  });

  it('does not let a lost database check replace an earlier connection with an outage', async () => {
    let checks = 0;
    const { service, at } = harness({
      connectivity: async () => {
        checks += 1;
        return checks === 1 ? 'connected' : 'disconnected';
      },
      fetch: async () => json({}),
      config: empty,
    });
    const first = await service.overview();
    expect(card(first, 'database').state).toBe('up');
    at('2026-11-05T10:01:01.000Z');
    const second = await service.overview();
    expect(card(second, 'database').stale).toBe(true);
    expect(card(second, 'database').state).toBe('up');
    expect(card(second, 'database').fetchedAt).toBe(card(first, 'database').fetchedAt);
    expect(checks).toBe(2);
  });

  it('does not turn a malformed provider body into an outage or a copied payload', async () => {
    const { service } = harness({
      fetch: async (url) => {
        if (url.includes('backboard.railway.com')) {
          return new Response('not-json sk_live_secret', { status: 200 });
        }
        if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'INACTIVE' });
        if (url.endsWith('/database/backups')) return json({ backups: [{ status: 'PENDING', inserted_at: '2026-11-02T00:00:00.000Z' }] });
        if (url.includes('/monitors/')) return json({ status: 'UP', interval: 60 });
        return json({ nextLink: null, data: [] });
      },
    });
    const overview = await service.overview();
    expect(card(overview, 'railway').state).toBe('unavailable');
    expect(card(overview, 'supabase_project').state).toBe('degraded');
    expect(card(overview, 'supabase_backup').state).toBe('degraded');
    expect(JSON.stringify(overview)).not.toContain('sk_live_secret');
  });

  it('distinguishes a rejected backup credential from a plan that exposes no backups', async () => {
    const denied = harness({
      fetch: async (url) => json({ message: 'sbp_secret' }, url.endsWith('/database/backups') ? 401 : 200),
    });
    const deniedOverview = await denied.service.overview();
    expect(card(deniedOverview, 'supabase_backup').state).toBe('unavailable');
    expect(JSON.stringify(deniedOverview)).not.toContain('sbp_secret');

    const plan = harness({
      fetch: async (url) => {
        if (url.endsWith('/database/backups')) return json({ message: 'plan secret' }, 403);
        if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'ACTIVE_HEALTHY' });
        if (url.includes('backboard')) return json(railwayDeployment('SUCCESS'));
        if (url.includes('/monitors/')) return json({ status: 'UP' });
        return json({ nextLink: null, data: [] });
      },
    });
    const planOverview = await plan.service.overview();
    expect(card(planOverview, 'supabase_backup').state).toBe('not_available');
    expect(JSON.stringify(planOverview)).not.toContain('plan secret');
  });

  it('does not replace a successful backup with a later refused backup request', async () => {
    let backups = 0;
    const { service, at } = harness({
      fetch: async (url) => {
        if (url.endsWith('/database/backups')) {
          backups += 1;
          if (backups === 1) {
            return json({
              backups: [{ status: 'COMPLETED', inserted_at: '2026-11-03T00:00:00.000Z' }],
            });
          }
          return json({ message: 'plan secret' }, 403);
        }
        if (url.endsWith(`/v1/projects/${REF}`)) return json({ status: 'ACTIVE_HEALTHY' });
        if (url.includes('backboard')) return json(railwayDeployment('SUCCESS'));
        if (url.includes('/monitors/')) return json({ status: 'UP' });
        return json({ nextLink: null, data: [] });
      },
    });
    const first = await service.overview();
    expect(card(first, 'supabase_backup').state).toBe('up');
    at('2026-11-05T10:01:01.000Z');
    const second = await service.overview();
    expect(card(second, 'supabase_backup').stale).toBe(true);
    expect(card(second, 'supabase_backup').state).toBe('up');
    expect(card(second, 'supabase_backup').fetchedAt).toBe(card(first, 'supabase_backup').fetchedAt);
    expect(JSON.stringify(second)).not.toContain('plan secret');
    at('2026-11-05T10:12:00.000Z');
    const expired = await service.overview();
    expect(card(expired, 'supabase_backup').state).toBe('not_available');
    expect(card(expired, 'supabase_backup').stale).toBe(false);
    await service.overview();
    expect(backups).toBe(3);
  });
});
