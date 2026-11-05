import type { OperationsConfig } from './operations.config';
import {
  MALFORMED_SUMMARY,
  RAILWAY_DASHBOARD_URL,
  SUPABASE_DASHBOARD_URL,
  TIMEOUT_SUMMARY,
  UPTIME_DASHBOARD_URL,
  type OpsCard,
  type OpsCardId,
  type OpsIncident,
  type OpsState,
} from './operations.types';

const PROJECT_UP = new Set(['ACTIVE_HEALTHY']);
const PROJECT_DOWN = new Set([
  'ACTIVE_UNHEALTHY',
  'INIT_FAILED',
  'RESTORE_FAILED',
  'PAUSE_FAILED',
  'REMOVED',
]);
const PROJECT_DEGRADED = new Set(['INACTIVE', 'PAUSING', 'GOING_DOWN']);
const PROJECT_UNKNOWN = new Set([
  'COMING_UP',
  'RESTARTING',
  'RESTORING',
  'UPGRADING',
  'RESIZING',
  'UNKNOWN',
]);

const BACKUP_UP = new Set(['COMPLETED']);
const BACKUP_DOWN = new Set(['FAILED']);
const BACKUP_DEGRADED = new Set(['PENDING']);

const MONITOR_UP = new Set(['UP']);
const MONITOR_DOWN = new Set(['DOWN']);
const MONITOR_DEGRADED = new Set(['LOOKS_DOWN']);

const COMMIT = /^[0-9a-f]{7,40}$/i;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_WORD = /^[A-Z0-9_]{1,40}$/;

export function supabaseProjectState(status: string): OpsState {
  if (PROJECT_UP.has(status)) return 'up';
  if (PROJECT_DOWN.has(status)) return 'down';
  if (PROJECT_DEGRADED.has(status)) return 'degraded';
  if (PROJECT_UNKNOWN.has(status)) return 'unknown';
  return 'unknown';
}

export function backupState(status: string): OpsState {
  if (BACKUP_UP.has(status)) return 'up';
  if (BACKUP_DOWN.has(status)) return 'down';
  if (BACKUP_DEGRADED.has(status)) return 'degraded';
  return 'unknown';
}

export function uptimeState(status: string): OpsState {
  if (status === 'PAUSED') return 'paused';
  if (MONITOR_UP.has(status)) return 'up';
  if (MONITOR_DOWN.has(status)) return 'down';
  if (MONITOR_DEGRADED.has(status)) return 'degraded';
  return 'unknown';
}

export function card(input: {
  id: OpsCardId;
  title: string;
  state: OpsState;
  summary: string;
  eventAt?: string | null;
  details?: OpsCard['details'];
  incidents?: OpsIncident[];
  dashboardUrl?: string | null;
}): OpsCard {
  return {
    id: input.id,
    title: input.title,
    state: input.state,
    stale: false,
    fetchedAt: null,
    eventAt: input.eventAt ?? null,
    summary: input.summary,
    details: input.details ?? [],
    incidents: input.incidents ?? [],
    dashboardUrl: input.dashboardUrl ?? null,
  };
}

export function notConfigured(id: OpsCardId, title: string, summary: string): OpsCard {
  return card({ id, title, state: 'not_configured', summary, dashboardUrl: dashboardFor(id) });
}

export function unavailable(id: OpsCardId, summary: string): OpsCard {
  return card({
    id,
    title: titleFor(id),
    state: 'unavailable',
    summary,
    dashboardUrl: dashboardFor(id),
  });
}

export function timeoutCard(id: OpsCardId): OpsCard {
  return unavailable(id, TIMEOUT_SUMMARY);
}

export function malformedCard(id: OpsCardId): OpsCard {
  return unavailable(id, MALFORMED_SUMMARY);
}

export function mapRailwayDeployment(
  body: unknown,
  serviceId: string,
): OpsCard {
  const nodes = deploymentNodes(body);
  if (!nodes) return malformedCard('railway');
  const matched = nodes.filter((node) => sameService(node, serviceId));
  if (matched.length === 0) {
    return card({
      id: 'railway',
      title: titleFor('railway'),
      state: 'unknown',
      summary: 'No deployment was returned for the configured service.',
      details: [{ label: 'Service', value: serviceId }],
      dashboardUrl: RAILWAY_DASHBOARD_URL,
    });
  }
  const sorted = [...matched].sort((left, right) => createdMs(right) - createdMs(left));
  const latest = sorted[0];
  const serving = sorted.find((node) => word(node.status) === 'SUCCESS');
  if (serving) return servingDeployment(serving, latest, serviceId);
  return attemptWithoutServing(latest, serviceId);
}

export function mapSupabaseProject(body: unknown, ref: string): OpsCard {
  const record = asRecord(body);
  const status = word(record?.status);
  if (!status) return malformedCard('supabase_project');
  const dashboardUrl = `${SUPABASE_DASHBOARD_URL}/project/${ref}`;
  return card({
    id: 'supabase_project',
    title: titleFor('supabase_project'),
    state: supabaseProjectState(status),
    summary: `Supabase reports this project as ${status}.`,
    details: [
      { label: 'Project', value: ref },
      { label: 'Provider status', value: status },
    ],
    dashboardUrl,
  });
}

export function mapSupabaseBackup(body: unknown, ref: string, nowMs: number): OpsCard {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.backups)) return malformedCard('supabase_backup');
  const logical = latestLogical(record.backups);
  const physicalAt = physicalTime(record.physical_backup_data, nowMs);
  const dashboardUrl = `${SUPABASE_DASHBOARD_URL}/project/${ref}`;
  if (!logical && !physicalAt) {
    return card({
      id: 'supabase_backup',
      title: titleFor('supabase_backup'),
      state: 'not_available',
      summary: 'No backup was returned. Daily backups depend on the project plan.',
      details: [{ label: 'Project', value: ref }],
      dashboardUrl,
    });
  }
  if (logical && (!physicalAt || logical.at >= physicalAt)) {
    return card({
      id: 'supabase_backup',
      title: titleFor('supabase_backup'),
      state: backupState(logical.status),
      summary: `The latest returned backup is ${logical.status}. This does not prove it can be restored.`,
      eventAt: new Date(logical.at).toISOString(),
      details: [
        { label: 'Project', value: ref },
        { label: 'Backup status', value: logical.status },
      ],
      dashboardUrl,
    });
  }
  return card({
    id: 'supabase_backup',
    title: titleFor('supabase_backup'),
    state: 'unknown',
    summary:
      'A physical backup time was returned. Completion was not included, and this does not prove it can be restored.',
    eventAt: new Date(physicalAt as number).toISOString(),
    details: [{ label: 'Project', value: ref }],
    dashboardUrl,
  });
}

export function mapMonitor(body: unknown, monitorId: string): OpsCard | null {
  const record = monitorRecord(body);
  if (!record) return null;
  const status = word(record.status);
  if (!status) return null;
  const interval = intervalSeconds(record.interval);
  return card({
    id: 'uptime',
    title: titleFor('uptime'),
    state: uptimeState(status),
    summary: monitorSummary(status),
    details: [
      { label: 'Monitor', value: monitorId },
      { label: 'Provider status', value: status },
      { label: 'Interval', value: interval ?? 'Not in the response' },
      { label: 'Last check', value: 'Not exposed by the API' },
    ],
    dashboardUrl: UPTIME_DASHBOARD_URL,
  });
}

export function mapIncidents(body: unknown): OpsIncident[] | null {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.data)) return null;
  const incidents: Array<OpsIncident & { atMs: number }> = [];
  for (const item of record.data.slice(0, 50)) {
    const row = asRecord(item);
    if (!row) continue;
    const status = word(row.status);
    const at = iso(row.startedAt);
    incidents.push({
      at,
      atMs: at ? Date.parse(at) : 0,
      label: status ?? 'Incident',
    });
  }
  incidents.sort((left, right) => right.atMs - left.atMs);
  return incidents.slice(0, 5).map(({ at, label }) => ({ at, label }));
}

const CONFIGURED_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIGURED_REF = /^[a-z]{20}$/;
const CONFIGURED_MONITOR = /^[1-9][0-9]{0,19}$/;

export function railwayConfigured(config: OperationsConfig): boolean {
  return Boolean(
    safeCredential(config.railwayProjectToken) &&
      config.railwayServiceId &&
      CONFIGURED_UUID.test(config.railwayServiceId),
  );
}

export function supabaseConfigured(config: OperationsConfig): boolean {
  return Boolean(
    safeCredential(config.supabaseManagementToken) &&
      config.supabaseProjectRef &&
      CONFIGURED_REF.test(config.supabaseProjectRef),
  );
}

export function uptimeConfigured(config: OperationsConfig): boolean {
  return Boolean(
    safeCredential(config.uptimeReadToken) &&
      config.uptimeMonitorId &&
      CONFIGURED_MONITOR.test(config.uptimeMonitorId),
  );
}

function safeCredential(value: string | null): boolean {
  return Boolean(value && value.length >= 8 && !/\s/.test(value));
}

export function titleFor(id: OpsCardId): string {
  switch (id) {
    case 'railway':
      return 'API deployment';
    case 'database':
      return 'Database connectivity';
    case 'supabase_project':
      return 'Supabase project';
    case 'supabase_backup':
      return 'Database backup';
    case 'uptime':
      return 'Production monitor';
  }
}

export function dashboardFor(id: OpsCardId): string {
  if (id === 'railway') return RAILWAY_DASHBOARD_URL;
  if (id === 'uptime') return UPTIME_DASHBOARD_URL;
  return SUPABASE_DASHBOARD_URL;
}

function monitorSummary(status: string): string {
  if (status === 'PAUSED') {
    return 'The monitor is paused. A paused monitor does not show that the application is unhealthy.';
  }
  if (status === 'LOOKS_DOWN') {
    return 'UptimeRobot reports LOOKS_DOWN. This is not a confirmed outage.';
  }
  if (status === 'STARTED') {
    return 'UptimeRobot reports STARTED. Up or down was not reported.';
  }
  return `UptimeRobot reports this monitor as ${status}. This is a periodic observation, not a deployment check.`;
}

function deploymentNodes(body: unknown): Record<string, unknown>[] | null {
  const data = asRecord(asRecord(body)?.data);
  const deployments = asRecord(data?.deployments);
  const edges = deployments?.edges;
  if (!Array.isArray(edges)) return null;
  return edges.flatMap((edge) => {
    const node = asRecord(asRecord(edge)?.node);
    return node ? [node] : [];
  });
}

function sameService(node: Record<string, unknown>, serviceId: string): boolean {
  if (typeof node.serviceId !== 'string') return true;
  return node.serviceId.toLowerCase() === serviceId;
}

function createdMs(node: Record<string, unknown>): number {
  const parsed = iso(node.createdAt);
  return parsed ? Date.parse(parsed) : 0;
}

function servingDeployment(
  serving: Record<string, unknown>,
  latest: Record<string, unknown>,
  serviceId: string,
): OpsCard {
  const latestStatus = word(latest.status);
  const differentAttempt = latest !== serving && latestStatus && latestStatus !== 'SUCCESS';
  const commit = commitHash(serving.meta);
  return card({
    id: 'railway',
    title: titleFor('railway'),
    state: 'up',
    summary: differentAttempt
      ? `Railway reports a successful deployment in the recent list. The latest attempt is ${latestStatus} and is not treated as the serving deployment. A successful record is deployment evidence, not continuous application-health proof.`
      : 'Railway reports a successful deployment in the recent list. A successful record is deployment evidence, not continuous application-health proof.',
    eventAt: iso(serving.createdAt),
    details: [
      { label: 'Service', value: serviceId },
      { label: 'Serving deployment', value: 'SUCCESS' },
      { label: 'Release', value: commit ?? 'Not in the API response' },
      ...deploymentIdDetail(serving, 'Serving deployment id'),
      ...(differentAttempt ? [{ label: 'Latest attempt', value: latestStatus as string }] : []),
    ],
    dashboardUrl: RAILWAY_DASHBOARD_URL,
  });
}

function attemptWithoutServing(latest: Record<string, unknown>, serviceId: string): OpsCard {
  const status = word(latest.status);
  if (!status) return malformedCard('railway');
  const crashed = status === 'CRASHED';
  const commit = commitHash(latest.meta);
  return card({
    id: 'railway',
    title: titleFor('railway'),
    state: crashed ? 'down' : 'unknown',
    summary: crashed
      ? 'The newest deployment crashed after starting, and no successful deployment was in the recent list.'
      : `The latest deployment attempt is ${status}. A serving deployment was not identified, so the application is not labeled down.`,
    eventAt: iso(latest.createdAt),
    details: [
      { label: 'Service', value: serviceId },
      { label: 'Latest attempt', value: status },
      ...(commit ? [{ label: 'Attempt release', value: commit }] : []),
      ...deploymentIdDetail(latest, 'Attempt deployment id'),
    ],
    dashboardUrl: RAILWAY_DASHBOARD_URL,
  });
}

function deploymentIdDetail(
  node: Record<string, unknown>,
  label: string,
): Array<{ label: string; value: string }> {
  if (typeof node.id !== 'string' || !UUID.test(node.id)) return [];
  return [{ label, value: node.id.toLowerCase() }];
}

function latestLogical(
  backups: unknown[],
): { status: string; at: number } | null {
  let best: { status: string; at: number } | null = null;
  for (const item of backups) {
    const row = asRecord(item);
    const status = word(row?.status);
    const at = timeMs(row?.inserted_at);
    if (!status || at === null) continue;
    if (!best || at > best.at) best = { status, at };
  }
  return best;
}

function physicalTime(value: unknown, nowMs: number): number | null {
  const record = asRecord(value);
  const unix = record?.latest_physical_backup_date_unix;
  if (typeof unix !== 'number' || !Number.isFinite(unix)) return null;
  const ms = unix * 1000;
  if (ms < Date.UTC(2020, 0, 1) || ms > nowMs + 86_400_000) return null;
  return ms;
}

function commitHash(meta: unknown): string | null {
  const record = asRecord(meta);
  const value = record?.commitHash;
  if (typeof value !== 'string' || !COMMIT.test(value)) return null;
  return value.toLowerCase();
}

function intervalSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 30 || value > 86_400) return null;
  return `${value} seconds`;
}

function monitorRecord(body: unknown): Record<string, unknown> | null {
  const record = asRecord(body);
  if (!record) return null;
  if (typeof record.status === 'string') return record;
  const nested = asRecord(record.data);
  if (nested && typeof nested.status === 'string') return nested;
  return null;
}

function word(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return SAFE_WORD.test(normalized) ? normalized : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function timeMs(value: unknown): number | null {
  const parsed = iso(value);
  return parsed ? Date.parse(parsed) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
