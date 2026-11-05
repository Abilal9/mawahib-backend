export const OPS_CARD_IDS = [
  'railway',
  'database',
  'supabase_project',
  'supabase_backup',
  'uptime',
] as const;

export type OpsCardId = (typeof OPS_CARD_IDS)[number];

export type OpsState =
  | 'up'
  | 'down'
  | 'degraded'
  | 'paused'
  | 'unknown'
  | 'unavailable'
  | 'not_configured'
  | 'not_available';

export type OpsDetail = {
  label: string;
  value: string;
};

export type OpsIncident = {
  at: string | null;
  label: string;
};

export type OpsCard = {
  id: OpsCardId;
  title: string;
  state: OpsState;
  stale: boolean;
  fetchedAt: string | null;
  eventAt: string | null;
  summary: string;
  details: OpsDetail[];
  incidents: OpsIncident[];
  dashboardUrl: string | null;
};

export type OperationsOverview = {
  generatedAt: string;
  cards: OpsCard[];
};

export const RAILWAY_DASHBOARD_URL = 'https://railway.com/dashboard';
export const SUPABASE_DASHBOARD_URL = 'https://supabase.com/dashboard';
export const UPTIME_DASHBOARD_URL = 'https://dashboard.uptimerobot.com/';

export const OPERATIONS_FRESH_MS = 60_000;
export const OPERATIONS_STALE_MS = 10 * 60_000;
export const OPERATIONS_TIMEOUT_MS = 4_000;
export const OPERATIONS_INCIDENT_LIMIT = 5;

export const TIMEOUT_SUMMARY =
  'The provider did not respond in time. This is not a confirmed outage.';
export const FAILURE_SUMMARY =
  'The provider request failed. This is not a confirmed outage.';
export const MALFORMED_SUMMARY =
  'The provider response could not be read. This is not a confirmed outage.';
export const RATE_SUMMARY =
  'The provider rate limit was reached. This is not a confirmed outage.';
