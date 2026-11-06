const RELEASE_SHA = /^[0-9a-f]{40}$/i;
const RAILWAY_REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const STATIC_SEGMENT = /^(?:[a-z][a-z-]{0,48}|v\d{1,2})$/;
const PUBLIC_SERVER_MESSAGES = new Set([
  'Account status could not be verified.',
  'Staff sign-in is not configured.',
  'Staff access is waiting for issuer-aware membership.',
  'Sign-in could not be verified right now.',
]);

const URL_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const BEARER = /\bBearer\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SECRET_KEY =
  'authorization|cookie|password|passwd|otp|token|secret|apikey|api_key|access_token|refresh_token|database_url';
const SECRET_ASSIGNMENT = new RegExp(
  `\\b(${SECRET_KEY})\\b\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|\\S+)`,
  'gi',
);
const SECRET_JSON = new RegExp(
  `"(${SECRET_KEY})"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`,
  'gi',
);

export function publicErrorPath(url: string | undefined): string {
  if (!url) {
    return '';
  }
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return path.slice(0, 200);
}

/** Log route with dynamic segments collapsed so one user cannot create a new label. */
export function logRoute(url: string | undefined): string {
  return publicErrorPath(url)
    .split('/')
    .map((segment) =>
      segment === '' || STATIC_SEGMENT.test(segment) ? segment : ':param',
    )
    .join('/');
}

export function railwayRequestId(
  headers: Record<string, unknown> | undefined,
): string | undefined {
  const raw = headers?.['x-railway-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !RAILWAY_REQUEST_ID.test(value)) {
    return undefined;
  }
  return value;
}

export function releaseIdentifier(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const sha = env.RAILWAY_GIT_COMMIT_SHA;
  if (typeof sha !== 'string' || !RELEASE_SHA.test(sha)) {
    return undefined;
  }
  return sha.toLowerCase();
}

export function redactDiagnosticText(value: string, maxLength: number): string {
  const bounded = value.slice(0, maxLength);
  return bounded
    .replace(URL_TEXT, '[redacted-url]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(JWT, '[redacted-token]')
    .replace(SECRET_JSON, '"$1":"[redacted]"')
    .replace(SECRET_ASSIGNMENT, '$1=[redacted]');
}

export function safePublicServerMessage(message: unknown): string {
  if (typeof message === 'string' && PUBLIC_SERVER_MESSAGES.has(message)) {
    return message;
  }
  return 'Internal server error';
}

export function unexpectedErrorName(exception: unknown): string {
  if (
    exception instanceof Error &&
    ERROR_NAME.test(exception.name)
  ) {
    return exception.name;
  }
  return exception instanceof Error ? 'Error' : 'NonError';
}

/**
 * Server-only frames. The error message is omitted because free text can
 * carry a credential, and unknown thrown values are not serialized.
 */
export function unexpectedErrorDetail(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) {
    return undefined;
  }
  const frames = exception.stack
    .split('\n')
    .map(stackLocation)
    .filter((line): line is string => line !== undefined)
    .join('\n');
  if (!frames) {
    return undefined;
  }
  return redactDiagnosticText(frames, 2000);
}

/** Keep file:line:column only. Function arguments are not a stack location. */
function stackLocation(line: string): string | undefined {
  if (!/^\s+at\s+/.test(line)) {
    return undefined;
  }
  const match = line.match(/([^\s()]+):(\d+):(\d+)\s*\)?\s*$/);
  if (!match) {
    return undefined;
  }
  return `${match[1]}:${match[2]}:${match[3]}`;
}
