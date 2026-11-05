const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_REF = /^[a-z]{20}$/;
const MONITOR_ID = /^[1-9][0-9]{0,19}$/;

export type OperationsConfig = {
  railwayProjectToken: string | null;
  railwayProjectId: string | null;
  railwayEnvironmentId: string | null;
  railwayServiceId: string | null;
  supabaseManagementToken: string | null;
  supabaseProjectRef: string | null;
  uptimeReadToken: string | null;
  uptimeMonitorId: string | null;
};

export function readOperationsConfig(
  env: NodeJS.ProcessEnv = process.env,
): OperationsConfig {
  return {
    railwayProjectToken: credential(env.OPS_RAILWAY_PROJECT_ACCESS_TOKEN),
    railwayProjectId: uuid(env.OPS_RAILWAY_PROJECT_ID) ?? uuid(env.RAILWAY_PROJECT_ID),
    railwayEnvironmentId:
      uuid(env.OPS_RAILWAY_ENVIRONMENT_ID) ?? uuid(env.RAILWAY_ENVIRONMENT_ID),
    railwayServiceId: uuid(env.OPS_RAILWAY_SERVICE_ID) ?? uuid(env.RAILWAY_SERVICE_ID),
    supabaseManagementToken: credential(env.OPS_SUPABASE_ACCESS_TOKEN),
    supabaseProjectRef: projectRef(env.SUPABASE_PROJECT_ID),
    uptimeReadToken: credential(env.OPS_UPTIMEROBOT_READ_TOKEN),
    uptimeMonitorId: monitorId(env.OPS_UPTIMEROBOT_MONITOR_ID),
  };
}

function credential(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || /\s/.test(trimmed)) return null;
  return trimmed;
}

function uuid(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}

function projectRef(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return PROJECT_REF.test(trimmed) ? trimmed : null;
}

function monitorId(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return MONITOR_ID.test(trimmed) ? trimmed : null;
}
